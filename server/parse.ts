/**
 * Парсинг распознанного текста страницы блокнота в кандидатов заявок.
 *
 * Блокнот обычно заполняется колонками: город, адрес, что случилось, телефон —
 * каждый на своей строке. Поэтому кандидат собирается из ГРУППЫ строк:
 * всё, что встретилось между двумя строками с телефонами, относится к заявке
 * с ближайшим (следующим за ними) телефоном.
 *
 * Правила:
 * - строка с телефоном начинает кандидата (телефон — главное поле);
 * - строки до телефона (город/адрес/комментарий) прикрепляются к кандидату;
 * - строки-«города» (только буквы) и адреса (ул., кв., дом и т.п.) — в адрес;
 * - остаток — комментарий; имя заполняется на экране проверки вручную;
 * - даты и цены из полей вырезаются;
 * - дубли телефонов убираются.
 */

export interface LeadCandidate {
  name: string;
  phone: string;
  address: string;
  service: string | null;
  comment: string;
  /** Исходная строка с телефоном — для сверки на экране проверки. */
  raw: string;
}

const DATE_RE = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g;
const PRICE_RE = /\b\d{2,4}\s*(?:руб|р\.?|₽)\b/gi;

/**
 * Телефон: +7/8 и 10 цифр, допускаем разделители и пропуски OCR.
 * ВАЖНО: разделители могут быть любыми (пробел, -, .), как в «8-905-113.29.62».
 */
const PHONE_RE =
  /(?:\+?7|8)\s*[(-]?\s*\d{3}\s*[)-]?\s*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}/;

/**
 * Адресные слова. НЕ используем \b — в JS он не понимает кириллицу и перед
 * «ул.»/«кв» граница не сработает. Вместо этого явный кириллический lookbehind.
 */
const ADDRESS_RE =
  /(?<![а-яёa-z0-9])(?:ул\.?|улица|г\.|город|дом|д\.|пр\.?|просп\.?|проспект|пер\.?|переулок|шоссе|мкр(?:он)?\.?|микрорайон|пос\.?|поселок|дер\.?|деревня|наб\.?|бул\.?|бульвар)(?![а-яёa-zA-Z0-9])/i;

const APARTMENT_RE =
  /(?<![а-яёa-z0-9])(?:кв\.?|квартира|подъезд|этаж)(?![а-яёa-zA-Z0-9])/i;

/** Строка-«город»: только буквы (например: Шекино, Ефремов, Богородецк). */
function isCityLine(value: string): boolean {
  return /^[а-яёА-ЯЁ][а-яёА-ЯЁ\- ]*$/.test(value) && value.length >= 2;
}

const SERVICE_KEYWORDS: { value: string; keys: RegExp }[] = [
  { value: "repair", keys: /(ремонт|не работ|сломан|сломал|замыкан|не открыв|не закрыв|поврежд|не звенит|не отвеча)/i },
  { value: "install", keys: /(установ|подключ|замен(?:а|ить)?|нове?й?\s+домофон|трубк|модул)/i },
  { value: "maintenance", keys: /(обслуж|профилакт|провер|тех(?:нич)?\.?\s+осмотр)/i },
  { value: "consult", keys: /(консульт|вопрос|уточн|сколько стоит|цена)/i },
];

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripJunk(value: string): string {
  return clean(value)
    .replace(DATE_RE, " ")
    .replace(PRICE_RE, " ")
    .replace(/[|/\\_=*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhone(match: string): string {
  let digits = match.replace(/\D/g, "");
  if (digits.startsWith("8") && digits.length === 11) {
    digits = "7" + digits.slice(1);
  } else if (digits.length === 10) {
    digits = "7" + digits;
  }
  if (digits.length === 11 && digits.startsWith("7")) {
    return "+" + digits;
  }
  return "+" + digits;
}

function detectService(text: string): string | null {
  for (const item of SERVICE_KEYWORDS) {
    if (item.keys.test(text)) return item.value;
  }
  return null;
}

/**
 * Собирает кандидата из контекста: строк до телефона + остаток строки с телефоном.
 * city — первая строка-«город»; адрес — строки с адресными словами/кв;
 * остальное — комментарий. Имя оставляем пустым: его заполняют на экране проверки.
 */
function buildCandidate(
  context: string[],
  phone: string,
  raw: string,
): LeadCandidate {
  let city = "";
  const addressParts: string[] = [];
  const rest: string[] = [];

  for (const line of context) {
    // Обрывки телефонных номеров («8 5») и прочую цифровую кашу пропускаем
    if (/^[\d\s\-().,+]+$/.test(line)) continue;
    if (!city && isCityLine(line)) {
      city = line;
    } else if (ADDRESS_RE.test(line) || APARTMENT_RE.test(line)) {
      addressParts.push(line);
    } else {
      rest.push(line);
    }
  }

  let address = clean(addressParts.join(", "));
  if (city) address = address ? `${city}, ${address}` : city;

  const comment = clean(rest.join(" "));
  const service = detectService(clean([...context, raw].join(" ")));

  return { name: "", phone, address, service, comment, raw };
}

export function parseCandidates(lines: string[]): LeadCandidate[] {
  const seen = new Set<string>();
  const candidates: LeadCandidate[] = [];
  // Строки, встретившиеся после прошлого телефона — контекст следующего кандидата
  let context: string[] = [];

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (line.length < 2) continue;

    const phoneMatch = line.match(PHONE_RE);

    if (!phoneMatch) {
      context.push(line);
      continue;
    }

    const phone = normalizePhone(phoneMatch[0]);
    if (!seen.has(phone)) {
      seen.add(phone);

      const beforeText = clean(line.slice(0, phoneMatch.index));
      const afterText = stripJunk(line.slice(phoneMatch.index! + phoneMatch[0].length));
      const ctx = [...context];
      if (beforeText) ctx.push(beforeText);
      if (afterText) ctx.push(afterText);

      candidates.push(buildCandidate(ctx, phone, rawLine));
    }
    context = [];
  }

  return candidates;
}
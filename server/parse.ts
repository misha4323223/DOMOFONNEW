/**
 * Парсинг распознанного текста страницы блокнота в кандидатов заявок.
 *
 * Блокнот обычно заполняется колонками: город, адрес, что случилось, телефон —
 * каждый на своей строке. Поэтому заявка (запись) собирается из ГРУППЫ строк.
 *
 * Границы записи:
 * - строка-«город» (только буквы, например «Шекино») — начало новой записи;
 * - строка с телефоном — телефон прикрепляется к текущей записи; если у текущей
 *   записи телефон уже есть — это уже следующая заявка.
 *
 * Запись БЕЗ телефона не выбрасывается: она становится кандидатом с пустым
 * телефоном — на экране проверки она помечается «Без телефона», и её не теряют.
 *
 * Правила разбора полей:
 * - города и адреса (ул., кв., дом и т.п.) — в адрес;
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
  /** Исходный текст записи — для сверки на экране проверки. */
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

/**
 * Строка-«город»: одно слово только из букв (Шекино, Ефремов, Богородецк).
 * Комментарии (»трубка», «замыкание», «сломался доводчик») сюда не попадают,
 * потому что либо состоят из нескольких слов, либо стоят ДО телефона —
 * город начинает НОВУЮ запись только после завершённой (см. parseCandidates).
 */
function isCityLine(value: string): boolean {
  return /^[а-яёА-ЯЁ]{2,}$/.test(value);
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
 * Собирает кандидата из контекста записи.
 * city — первая строка-«город»; адрес — строки с адресными словами/кв;
 * остальное — комментарий. Имя оставляем пустым: его заполняют на экране проверки.
 * phone может быть пустой строкой — тогда это запись «без телефона».
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
      const cleaned = stripJunk(line);
      if (cleaned) rest.push(cleaned);
    }
  }

  let address = clean(addressParts.join(", "));
  if (city) address = address ? `${city}, ${address}` : city;

  const comment = clean(rest.join(" "));
  const service = detectService(clean([...context, raw].join(" ")));

  return { name: "", phone, address, service, comment, raw };
}

interface RawRecord {
  context: string[];
  phone: string;
  rawPhoneLine: string;
}

export function parseCandidates(lines: string[]): LeadCandidate[] {
  const seen = new Set<string>();
  const candidates: LeadCandidate[] = [];
  let current: RawRecord | null = null;

  const closeCurrent = () => {
    if (!current) return;
    const { context, phone, rawPhoneLine } = current;

    // Запись без телефона создаём только при наличии адресного ориентира
    // (ул./кв./дом) — иначе это мусорный текст (цены, товары) без привязки.
    if (!phone) {
      const hasAddressHint = context.some(
        (l) => ADDRESS_RE.test(l) || APARTMENT_RE.test(l),
      );
      if (!hasAddressHint) {
        current = null;
        return;
      }
    }

    // Записи с телефоном — только уникальные; без телефона — всегда
    if (!phone || !seen.has(phone)) {
      if (phone) seen.add(phone);
      const raw = rawPhoneLine || clean(context.join(" ")) || "(без текста)";
      candidates.push(buildCandidate(context, phone, raw));
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (line.length < 2) continue;

    const phoneMatch = line.match(PHONE_RE);

    if (phoneMatch) {
      // У текущей записи уже есть телефон — строка начала следующую заявку
      if (current && current.phone) closeCurrent();
      if (!current) current = { context: [], phone: "", rawPhoneLine: rawLine };
      if (!current.phone) {
        current.phone = normalizePhone(phoneMatch[0]);
        current.rawPhoneLine = rawLine;
        const beforeText = clean(line.slice(0, phoneMatch.index));
        if (beforeText) current.context.push(beforeText);
        const afterText = stripJunk(
          line.slice(phoneMatch.index! + phoneMatch[0].length),
        );
        if (afterText) current.context.push(afterText);
      }
      continue;
    }

    // Строка-«город» — начало новой записи, но ТОЛЬКО если предыдущая
    // запись уже завершена телефоном (иначе это может быть однословный
    // комментарий вроде «трубка», стоящий до телефона)
    if (isCityLine(line)) {
      if (current && current.phone) closeCurrent();
      if (!current) current = { context: [], phone: "", rawPhoneLine: "" };
      current.context.push(line);
      continue;
    }

    current = current ?? { context: [], phone: "", rawPhoneLine: "" };
    current.context.push(line);
  }

  closeCurrent();
  return candidates;
}
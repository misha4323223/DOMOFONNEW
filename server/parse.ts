/**
 * Парсинг распознанного текста страницы блокнота в кандидатов заявок.
 *
 * Правила:
 * - строка становится кандидатом, только если в ней найден телефон
 *   (так отсекаются записи блокнота без телефона — например, цены);
 * - имя — слова перед телефоном;
 * - адрес — фрагмент от первого адресного слова (ул., г., дом и т.п.);
 * - услуга — по ключевым словам;
 * - остаток строки — комментарий;
 * - даты (дд.мм.гг) из полей вырезаются.
 */

export interface LeadCandidate {
  name: string;
  phone: string;
  address: string;
  service: string | null;
  comment: string;
  /** Исходная строка как распознана — для сверки на экране проверки. */
  raw: string;
}

const DATE_RE = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g;
const PRICE_RE = /\b\d{2,4}\s*(?:руб|р\.?|₽)\b/gi;

/** Телефон: +7/8 и 10 цифр, допускаем разделители и пропуски OCR. */
const PHONE_RE =
  /(?:\+?7|8)\s*[(-]?\s*\d{3}\s*[)-]?\s*\d{3}\s*[- ]?\s*\d{2}\s*[- ]?\s*\d{2}/;

const ADDRESS_RE =
  /\b(?:ул\.?|улица|г\.|город|дом|д\.|пр\.?|просп\.?|проспект|пер\.?|переулок|шоссе|мкр(?:он)?\.?|микрорайон|пос\.?|поселок|дер\.?|деревня|наб\.?|бул\.?|бульвар)\b/i;

const SERVICE_KEYWORDS: { value: string; keys: RegExp }[] = [
  { value: "repair", keys: /(ремонт|не работ|сломан|не открыв|не закрыв|поврежд)/i },
  { value: "install", keys: /(установ|подключ|замен(?:а|ить)?|нове?й?\s+домофон)/i },
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

export function parseCandidates(lines: string[]): LeadCandidate[] {
  const seen = new Set<string>();
  const candidates: LeadCandidate[] = [];

  for (const rawLine of lines) {
    const line = clean(rawLine);
    if (line.length < 4) continue;

    const phoneMatch = line.match(PHONE_RE);
    if (!phoneMatch) continue;

    let rest = stripJunk(line);
    if (rest.length < 4) continue;

    const phone = normalizePhone(phoneMatch[0]);
    if (seen.has(phone)) continue;
    seen.add(phone);

    // Фрагменты до открывающей скобки телефона и после неё
    const phoneStart = line.indexOf(phoneMatch[0]);
    const before = clean(line.slice(0, phoneStart));
    const afterRaw = line.slice(phoneStart + phoneMatch[0].length);

    // Адрес ищем в части после телефона (и иногда до неё)
    let address = "";
    let comment = "";
    const addrIdxAfter = afterRaw.search(ADDRESS_RE);
    const addrIdxBefore = before.search(ADDRESS_RE);
    if (addrIdxAfter !== -1) {
      address = clean(afterRaw.slice(addrIdxAfter));
      comment = clean(afterRaw.slice(0, addrIdxAfter));
    } else if (addrIdxBefore !== -1) {
      address = clean(before.slice(addrIdxBefore));
      comment = clean(afterRaw);
    } else {
      comment = clean(afterRaw);
    }

    // Комментарий/адрес чистим от дат и цен
    address = stripJunk(address);
    comment = stripJunk(comment);

    // Имя: всё до телефона минус адресные слова и мусор
    let name = clean(before);
    if (addrIdxBefore !== -1) name = clean(before.slice(0, addrIdxBefore));
    name = stripJunk(name);
    // Выкидываем приветствия/служебное
    name = name.replace(/^(?:здравствуйте|добрый|заявка|клиент|телик)\b/gi, "").trim();

    const service = detectService(line) ?? detectService(rest);

    if (!name && !address) continue;

    candidates.push({
      name,
      phone,
      address,
      service,
      comment,
      raw: rawLine,
    });
  }

  return candidates;
}
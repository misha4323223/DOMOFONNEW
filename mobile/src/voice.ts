/**
 * Разбор голосовой диктовки для формы заявки.
 *
 * Пользователь надиктовывает заявку одним куском, например:
 *   «Щёкино, улица Шахтёрская 29, трубка не работает, телефон 8 999 123 45 67»
 * Функция parseVoiceLead раскладывает текст по полям:
 *   — телефон ищется по маске российского номера (в т.ч. цифры словами);
 *   — город — первая часть до запятой (или до адресного слова), если она
 *     не похожа на адрес;
 *   — адрес — текст от адресного слова до первого признака проблемы;
 *   — остальное (признаки проблемы) — в комментарий.
 */

export interface ParsedVoiceLead {
  city: string;
  phone: string;
  address: string;
  comment: string;
}

/** Слова-цифры → цифры (распознавание речи часто отдаёт номера словами). */
const DIGIT_WORDS: Array<[string, string]> = [
  ["ноль", "0"],
  ["один", "1"],
  ["одна", "1"],
  ["два", "2"],
  ["две", "2"],
  ["три", "3"],
  ["четыре", "4"],
  ["пять", "5"],
  ["шесть", "6"],
  ["семь", "7"],
  ["восемь", "8"],
  ["девять", "9"],
];

/** Признаки того, что фрагмент текста — адрес. */
const ADDRESS_MARKERS = [
  "улица", "ул",
  "проспект", "пр-т",
  "переулок", "пер",
  "шоссе", "бульвар", "б-р",
  "микрорайон", "мкр",
  "набережная", "наб",
  "площадь", "пл",
  "дом", "квартира", "кв", "корпус", "корп", "строение", "стр",
];

/** Слова-триггеры: с них начинается описание проблемы (комментарий). */
const COMMENT_TRIGGERS = [
  "не работает", "неработает",
  "не слышно", "неслышно", "не слышен", "не слышна",
  "не открывает", "не закрывает", "не включается", "не отвечает",
  "не подходит", "нет связи", "нет сигнала", "не открывается",
  "сломался", "сломалась", "сломалось", "сломан",
  "поломка", "починить", "почини", "отремонтировать", "отремонтируй",
  "ремонт", "установить", "установи", "заменить", "замени",
  "подключить", "подключи", "настроить", "настрой", "проверить", "проверь",
  "шумит", "трещит", "гудит", "пищит", "хрипит",
  "домофон", "трубка", "панель", "кнопка", "дверь", "замок", "доводчик",
  "проблема", "проблемы", "плохо", "заедает", "залипает",
];

/** Заменяет слова-цифры на цифры по всему тексту (с учётом границ слова). */
function digitsFromWords(text: string): string {
  let out = text;
  for (const [word, digit] of DIGIT_WORDS) {
    const re = new RegExp(`(^|[^а-яёa-z])${word}(?![а-яёa-z])`, "gi");
    out = out.replace(re, `$1${digit}`);
  }
  return out;
}

/** Содержит ли фрагмент признак адреса (улица/дом/… как отдельное слово). */
function hasAddressMarker(text: string): boolean {
  const lower = ` ${text.toLowerCase()} `;
  for (const marker of ADDRESS_MARKERS) {
    if (lower.includes(` ${marker} `) || lower.includes(` ${marker}. `)) return true;
  }
  return false;
}

/** Позиция первого признака проблемы в тексте, -1 если нет. */
function firstTriggerIndex(text: string): number {
  const lower = text.toLowerCase();
  let best = -1;
  for (const trigger of COMMENT_TRIGGERS) {
    const idx = lower.indexOf(trigger);
    if (idx >= 0 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

/**
 * Приводит телефон к виду «+7 999 123 45 67».
 * Если распознать номер не удалось — возвращает исходный текст.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  let national = "";
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else {
    return raw.trim();
  }
  return `+7 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8, 10)}`;
}

/** Телефон: +7/8 + 10 цифр, допускаются пробелы, дефисы, скобки. */
const PHONE_RE = /(?:\+?7|8)\s*[-\s(]*\d{3}[-\s)]*\d{3}[-\s]*\d{2}[-\s]*\d{2}/;

/** Раскладывает надиктованный текст по полям заявки. */
export function parseVoiceLead(raw: string): ParsedVoiceLead {
  let text = digitsFromWords(raw).replace(/\s+/g, " ").trim();
  const result: ParsedVoiceLead = { city: "", phone: "", address: "", comment: "" };

  // Телефон — ищем по всему тексту и вырезаем.
  const phoneMatch = text.match(PHONE_RE);
  if (phoneMatch) {
    result.phone = normalizePhone(phoneMatch[0]);
    text = text.replace(phoneMatch[0], " ").replace(/\s+/g, " ").trim();
  }

  // Город: часть до первой запятой, если она не похожа на адрес.
  const commaIdx = text.indexOf(",");
  if (commaIdx >= 0) {
    const head = text.slice(0, commaIdx).trim();
    const rest = text.slice(commaIdx + 1).trim();
    const cityClean = head.replace(/^(город|гор|г)\.?\s+/i, "").trim();
    if (cityClean.length > 0 && cityClean.length < 40 && !hasAddressMarker(cityClean)) {
      result.city = cityClean;
      text = rest;
    }
  }

  // Город без запятой: «Щёкино улица Шахтёрская 29» → город до адресного слова.
  if (!result.city) {
    const m = text.match(/^(.{1,40}?)\s+(улица|ул\.?|проспект|пр-т|переулок|пер\.?|шоссе|бульвар|микрорайон|мкр\.?|набережная|площадь|дом)\b/i);
    if (m && !hasAddressMarker(m[1])) {
      result.city = m[1].trim();
      text = text.slice(m[1].length).trim();
    }
  }

  // Адрес и комментарий.
  const triggerIdx = firstTriggerIndex(text);
  if (triggerIdx >= 0) {
    const addr = text.slice(0, triggerIdx).trim();
    const comment = text.slice(triggerIdx).trim();
    if (addr && (hasAddressMarker(addr) || /\d/.test(addr))) {
      result.address = addr;
      result.comment = comment;
    } else {
      // Признака адреса нет — значит, это просто описание проблемы.
      result.comment = text;
    }
  } else if (hasAddressMarker(text) || /\d/.test(text)) {
    result.address = text;
  } else {
    result.comment = text;
  }

  return result;
}
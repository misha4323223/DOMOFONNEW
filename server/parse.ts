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

// ---------------------------------------------------------------------------
// Разбор надиктованной фразы (голосовое создание заявки)
//
// Диктовка не похожа на страницу блокнота: это одна фраза, где поля идут в
// естественном порядке — «имя, телефон, адрес, что случилось». Поэтому делим
// фразу не по строкам, а по смыслу:
//   1) телефон — он есть в любом месте фразы и отделяет имя от остального;
//   2) имя — слова до адреса и до описания работ;
//   3) адрес — от первого адресного слова и до описания работ;
//   4) остаток — комментарий (что нужно сделать).
// ---------------------------------------------------------------------------

/** Поля заявки, найденные в надиктованной фразе. */
export interface DictatedLead {
  name: string;
  phone: string;
  address: string;
  service: string | null;
  comment: string;
}

/** Служебные слова в начале фразы: «заявка», «запиши», «новый клиент»… */
const DICTATION_FILLER_RE =
  /^(?:заявка|заявку|нов(?:ый|ая|ое|ого)|клиент[ауы]?|абонент[ауы]?|записать|запиши|записывай|создать|создай|добавить|добавь|внести|внеси|принять|прими|телефон|номер|плюс|ещё|еще|ну|вот|это|пожалуйста)(?![а-яёa-z])/i;

/**
 * Начало описания работ или неисправности — с этого места начинается
 * комментарий, поэтому адрес и имя ищем только ЛЕВЕЕ него.
 * Список заведомо шире строгого: лишнее слово в комментарии не страшно,
 * а вот потерянный адрес — страшно.
 */
const DICTATION_PROBLEM_RE =
  /^(?:не|нет|ничего|ни|работ|открыв|закрыв|звен|отвеча|слышн|включ|выключ|свет|сломал|сломан|замыка|замкну|течёт|течет|потек|шум|гудит|гудок|барахлит|неполадк|проблем|жалоб|плохо|слаб|нужно|надо|проси|просят|просил|хочет|хотят|установ|подключ|замен|отремонтир|ремонт|обслуж|провер|настро|консульт|вопрос|уточн|сколько|цена|стоимост|стоит|срок)/i;

/** Слово состоит только из букв (имя, город, улица). */
const WORD_ONLY_RE = /^[а-яё]+$/i;

/** Инициал: «И.», «П.А.» */
const INITIALS_RE = /^(?:[а-яё]\.){1,2}$/i;

/** Улица/адресное слово — начало адресной части. */
function isAddressWord(token: string): boolean {
  return ADDRESS_RE.test(token) || APARTMENT_RE.test(token);
}

/** Похоже на продолжение адреса: название улицы, номер дома, корпус. */
function isAddressContinuation(token: string): boolean {
  if (/^\d/.test(token)) return true;
  return WORD_ONLY_RE.test(token);
}

/** Токен начинает описание работ/неисправности? (проверяем и пару слов) */
function isProblemStart(tokens: string[], index: number): boolean {
  const one = tokens[index] ?? "";
  if (DICTATION_PROBLEM_RE.test(one)) return true;
  const two = `${one} ${tokens[index + 1] ?? ""}`.trim();
  return DICTATION_PROBLEM_RE.test(two);
}

/**
 * Сколько слов в начале фразы похожи на имя. Имя — 1–3 слова из букв
 * (инициалы допускаем), идущие до адресных слов и до описания работ.
 * Первое слово адресное/служебное — имени нет (вернём 0).
 */
function countNameTokens(tokens: string[]): number {
  let taken = 0;
  for (let i = 0; i < tokens.length && taken < 3; i++) {
    const token = tokens[i];
    if (isAddressWord(token)) break;
    if (isProblemStart(tokens, i)) break;
    if (!WORD_ONLY_RE.test(token) && !INITIALS_RE.test(token)) break;
    // «Иванов Иван Шекино, улица Ленина 12»: перед адресным словом после двух
    // слов имени стоит уже город — оставляем его адресу, а не имени.
    if (taken >= 2 && isAddressWord(tokens[i + 1] ?? "")) break;
    taken++;
  }
  return taken;
}

/** Убрать служебные слова в начале фразы («заявка», «ну», «запиши»…). */
function stripFiller(text: string): string {
  let value = clean(text);
  // Служебных слов в начале может быть несколько подряд
  for (let i = 0; i < 4; i++) {
    const next = value.replace(DICTATION_FILLER_RE, "").trim();
    if (next === value) break;
    value = next;
  }
  return value;
}

function capitalizeFirst(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * Разобрать надиктованную фразу в поля заявки.
 * Незнакомое не теряем: всё, что не опознано, попадает в комментарий.
 */
export function parseDictation(raw: string): DictatedLead {
  const result: DictatedLead = {
    name: "",
    phone: "",
    address: "",
    service: null,
    comment: "",
  };

  const original = stripFiller(raw);
  if (!original) return result;

  // --- Телефон: он делит фразу на часть с именем и всё остальное ---
  const phoneMatch = original.match(PHONE_RE);
  if (phoneMatch) result.phone = normalizePhone(phoneMatch[0]);
  const beforePhone = phoneMatch
    ? stripFiller(original.slice(0, phoneMatch.index))
    : "";
  // Служебные слова бывают и после телефона: «…, номер 8916…, добавить заявку К…»
  const afterPhone = phoneMatch
    ? stripFiller(original.slice(phoneMatch.index! + phoneMatch[0].length))
    : original;

  // --- Имя: слова перед телефоном; если телефон продиктовали первым —
  //     имя стоит сразу после него ---
  const beforeTokens = clean(beforePhone.replace(/[,;]/g, " "))
    .split(" ")
    .filter(Boolean);
  let nameTokensUsed = 0;
  const nameFromBefore = countNameTokens(beforeTokens);
  if (nameFromBefore > 0) {
    result.name = clean(beforeTokens.slice(0, nameFromBefore).join(" "));
  }

  // --- Остаток фразы: адрес и что случилось ---
  const tokens = clean(afterPhone.replace(/[,;]/g, " "))
    .split(" ")
    .filter(Boolean);

  if (!result.name) {
    nameTokensUsed = countNameTokens(tokens);
    if (nameTokensUsed > 0) {
      result.name = clean(tokens.slice(0, nameTokensUsed).join(" "));
    }
  }

  const addressParts: string[] = [];
  const commentParts: string[] = [];
  // Слова перед телефоном, не вошедшие в имя: обычно это описание работ,
  // сказанное до номера («нужно проверить домофон 8916…») — не теряем его.
  for (const token of beforeTokens.slice(nameFromBefore)) {
    commentParts.push(token);
  }
  let problemStarted = false;

  for (let i = nameTokensUsed; i < tokens.length; i++) {
    const token = tokens[i];

    if (!problemStarted && isProblemStart(tokens, i)) problemStarted = true;
    if (problemStarted) {
      commentParts.push(token);
      continue;
    }

    if (isAddressWord(token)) {
      // Новая часть адреса — с запятой: «Ефремов, улица Мира дом 5»
      if (addressParts.length) addressParts.push(",");
      addressParts.push(token);
      // За адресным словом тянем название улицы и номер дома (но не весь хвост)
      let taken = 0;
      while (i + 1 < tokens.length && taken < 3) {
        const next = tokens[i + 1];
        if (isAddressWord(next)) break;
        if (isProblemStart(tokens, i + 1)) break;
        if (!isAddressContinuation(next)) break;
        addressParts.push(next);
        i++;
        taken++;
        if (/^\d/.test(next)) break; // после номера дома адрес обычно закончился
      }
      continue;
    }

    // Одиночное слово из букв перед адресным словом — это город
    // («Ефремов улица Мира 5», «Шекино, улица Ленина 12»).
    // Всё остальное, что не опознано, уходит в комментарий — не теряем.
    const isCity =
      !addressParts.length &&
      WORD_ONLY_RE.test(token) &&
      isAddressWord(tokens[i + 1] ?? "");
    if (isCity) {
      addressParts.push(token);
      continue;
    }

    commentParts.push(token);
  }

  // «город Ефремов» → «Ефремов»: служебное слово перед названием убираем
  result.address = capitalizeFirst(
    clean(
      addressParts
        .join(" ")
        .replace(/\s+,/g, ",")
        .replace(/,\s*/g, ", ")
        .replace(/^(?:город|г\.)\s+/i, "")
        .replace(/\s+(?:город|г\.)\s+/i, " "),
    ),
  );
  result.comment = capitalizeFirst(clean(commentParts.join(" ")));
  result.service = detectService(original);

  return result;
}
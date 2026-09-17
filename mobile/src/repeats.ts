/**
 * Повторные обращения одного абонента.
 *
 * Зачем: человек обращается не первый раз — это надо видеть сразу, а в архиве
 * заявки одного абонента должны лежать одной карточкой с историей визитов,
 * а не десятком отдельных строк.
 *
 * Всё считается на устройстве: приложение и так загружает весь список заявок
 * (и активные, и архив) одним запросом, поэтому ни новых таблиц, ни новых
 * эндпоинтов не нужно — и офлайн тоже работает.
 *
 * Кого считаем «тем же»: совпал телефон (последние 10 цифр) или адрес —
 * улица + дом + квартира. Город работает разделителем и срабатывает последним:
 * он сравнивается только тогда, когда известен у обеих заявок (у заявок с
 * сайта он в адресе, у добавленных вручную — в поле города). Иначе «ул. Ленина,
 * д. 5» из Богородицка склеилось бы с такой же улицей из Щёкино, а клиент,
 * написавший только «Ленина 5», не нашёл бы свою прошлую заявку.
 *
 * Копия модуля для сайта — shared/repeats.ts: Metro не умеет импортировать
 * файлы за пределами корня mobile/, поэтому модуль продублирован (как и типы
 * заявок). При правках здесь — синхронизировать туда, если понадобится в вебе.
 */

import { leadCity } from "./city";

/** Минимум полей заявки, который нужен для поиска повторов. */
export interface RepeatLead {
  id: string;
  name: string;
  phone: string;
  address: string;
  service: string;
  status: string;
  source?: string;
  archived?: string;
  createdAt: string;
}

/** Разобранный адрес: «ул. Ленина, д. 5, кв. 12» → ленина / 5 / 12. */
export interface AddressParts {
  /** Корень названия улицы: «ленина». Пусто — улицу не поняли. */
  street: string;
  /** Номер дома: «5», «5а», «5/1». Пусто — дома в адресе нет. */
  house: string;
  /** Номер квартиры: «12». Пусто — квартиры в адресе нет. */
  flat: string;
}

/** Что известно про заявку: какая по счёту и что совпало с прошлыми. */
export interface VisitInfo<T extends RepeatLead> {
  /** Какая это заявка у абонента: 1 — первая, 3 — третья. */
  order: number;
  /** Сколько всего заявок у абонента (включая эту). */
  total: number;
  /** Предыдущая заявка абонента, если она есть. */
  previous: T | null;
  /** Отмечена ли заявка повторной из-за телефона. */
  byPhone: boolean;
  /** Отмечена ли заявка повторной из-за адреса. */
  byAddress: boolean;
}

/** История одного абонента — для слитой карточки в архиве. */
export interface ClientGroup<T extends RepeatLead> {
  /** Заявки абонента, свежие — первыми. */
  leads: T[];
  /** Последняя заявка: по ней рисуем карточку. */
  latest: T;
  /** Совпал ли телефон хотя бы у двух заявок группы. */
  byPhone: boolean;
  /** Совпал ли адрес хотя бы у двух заявок группы. */
  byAddress: boolean;
}

/** Слова-пометки в адресе — сами по себе они ничего не значат. */
const MARKERS = new Set([
  "ул", "улица", "улицы", "просп", "проспект", "пер", "переулок", "ш", "шоссе",
  "д", "дом", "кв", "квартира", "корп", "корпус", "стр", "строение", "литер",
  "г", "город", "обл", "область", "район", "р", "н", "тульская", "россия",
  "подъезд", "п", "эт", "этаж", "офис", "оф", "помещение", "пом",
]);

const HOUSE_TOKENS = new Set(["корп", "корпус", "к", "стр", "строение", "литер"]);
const NUMBER_RE = /^\d+[а-я]?([/-]\d+[а-я]?)?$/;

/**
 * Привести номер дома к одному виду.
 *
 * «5/1» — это тот же дом 5 корпус 1, что и «д. 5 корп. 1», поэтому слэш
 * превращаем в «к». Буква остаётся частью дома: 5а ≠ 5.
 */
function normalizeHouse(value: string): string {
  return value.replace(/\//g, "к");
}

/** Телефон без форматирования: только цифры, последние 10 (ведущая 7/8 — лишняя). */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Разобрать адрес на улицу, дом и квартиру. */
export function parseAddress(address: string): AddressParts {
  const tokens = address
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,;:()"'«»]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let street = "";
  let house = "";
  let flat = "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1] ?? "";

    if (token === "кв" || token === "квартира") {
      if (NUMBER_RE.test(next)) flat = next;
      continue;
    }
    if (token === "д" || token === "дом") {
      if (NUMBER_RE.test(next)) house = normalizeHouse(next);
      continue;
    }
    if (token === "ул" || token === "улица") {
      if (!street && next && !NUMBER_RE.test(next) && !MARKERS.has(next)) street = next;
      continue;
    }
    if (HOUSE_TOKENS.has(token)) {
      // «д. 5 корп. 1» — корпус идёт в тот же ключ дома, чтобы 5 и 5к1 не путались
      if (house && NUMBER_RE.test(next)) house += "к" + normalizeHouse(next);
      continue;
    }
    if (NUMBER_RE.test(token)) {
      if (!house) {
        // Число без пометки: «Ленина 5» — дом, «Ленина 5-12» — дом и квартира
        const [first, second] = token.split("-");
        house = normalizeHouse(first ?? "");
        if (second) flat = second;
      }
      continue;
    }
    if (MARKERS.has(token)) continue;
    // Город и регион в ключе улицы не нужны — город сравниваем отдельно
    if (!street && !leadCityPart(token)) street = token;
  }

  return { street, house, flat };
}

/** Слово, которое является городом или регионом (а не улицей). */
function leadCityPart(word: string): boolean {
  return ["богородицк", "богородицке", "щекино", "щекине", "ефремов", "ефремове", "тульская", "область"].includes(word);
}

/**
 * Ключ объекта без города и квартиры: «ленина|5». Пусто — сверять нечего.
 *
 * Квартира в ключ не входит: адрес — свободный текст, и один раз клиент пишет
 * «кв. 12», а другой раз просто «Ленина 5». Если у одной из заявок квартиры
 * нет — считаем её неизвестной, а не другой; если у обеих есть и они разные —
 * это разные абоненты (см. sameObject).
 */
function addressKey(parts: AddressParts): string {
  if (!parts.street && !parts.house) return "";
  return `${parts.street}|${parts.house}`;
}

/** Время заявки: по нему строим историю. */
function timeOf(lead: RepeatLead): number {
  const value = Date.parse(lead.createdAt);
  return Number.isNaN(value) ? 0 : value;
}

interface Entry<T extends RepeatLead> {
  lead: T;
  phone: string;
  /** Ключ улицы и дома: «ленина|5». */
  address: string;
  /** Квартира: пусто — в адресе её нет. */
  flat: string;
  city: string;
}

/** Похоже ли, что две заявки — про один и тот же объект (без учёта города). */
function sameObject<T extends RepeatLead>(a: Entry<T>, b: Entry<T>): boolean {
  if (!a.address || a.address !== b.address) return false;
  // Квартира сравнивается, только если известна у обеих заявок
  return !a.flat || !b.flat || a.flat === b.flat;
}

/** Разобрать все заявки, слить в группы и разложить историю по каждой заявке. */
export function analyzeLeads<T extends RepeatLead>(leads: T[]): {
  /** Для каждой заявки — какая она по счёту и что совпало. */
  index: Map<string, VisitInfo<T>>;
  /** Абоненты: заявки одной группы, свежие — первыми. */
  groups: ClientGroup<T>[];
} {
  const entries: Entry<T>[] = leads.map((lead) => {
    const parts = parseAddress(lead.address);
    return {
      lead,
      phone: phoneKey(lead.phone),
      address: addressKey(parts),
      flat: parts.flat,
      city: leadCity(lead) ?? "",
    };
  });

  // Объединение заявок в группы (система непересекающихся множеств).
  // Инвариант: в группе не может быть двух разных городов. Поэтому «город
  // неизвестен» никого не склеивает через себя: если рядом есть Ленина 5 из
  // Богородицка и Ленина 5 из Щёкино, они не станут одним абонентом.
  const parent = entries.map((_, i) => i);
  const rootCities = new Map<number, Set<string>>();
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    parent[i] = root;
    return root;
  };
  const citiesOf = (root: number): Set<string> => rootCities.get(root) ?? new Set<string>();

  /** Запомнить город заявки за её группой — по нему и ловим противоречие. */
  const addCity = (i: number, city: string) => {
    const root = find(i);
    const cities = new Set(citiesOf(root));
    cities.add(city);
    rootCities.set(root, cities);
  };

  /** Объединить, если у заявок нет противоречия по городу. Телефон — всегда можно. */
  const union = (a: number, b: number, ignoreCity = false): boolean => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return true;
    const merged = new Set([...citiesOf(ra), ...citiesOf(rb)]);
    if (!ignoreCity && merged.size > 1) return false;
    parent[ra] = rb;
    rootCities.set(rb, merged);
    rootCities.delete(ra);
    return true;
  };

  const phoneFirst = new Map<string, number>();
  const byAddress = new Map<string, number[]>();

  entries.forEach((entry, i) => {
    if (entry.city) addCity(i, entry.city);

    // Телефон — сильный признак: один человек может звонить по разным адресам,
    // поэтому город здесь не помеха.
    if (entry.phone) {
      const first = phoneFirst.get(entry.phone);
      if (first === undefined) phoneFirst.set(entry.phone, i);
      else union(i, first, true);
    }
    if (entry.address) {
      const same = byAddress.get(entry.address) ?? [];
      for (const prev of same) {
        if (sameObject(entry, entries[prev])) union(i, prev);
      }
      same.push(i);
      byAddress.set(entry.address, same);
    }
  });

  // Заявки по группам, внутри группы — от старых к новым
  const buckets = new Map<number, Entry<T>[]>();
  entries.forEach((entry, i) => {
    const root = find(i);
    const list = buckets.get(root) ?? [];
    list.push(entry);
    buckets.set(root, list);
  });

  const index = new Map<string, VisitInfo<T>>();
  const groups: ClientGroup<T>[] = [];

  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort((a, b) => timeOf(a.lead) - timeOf(b.lead));

    let byPhone = false;
    let byAddress = false;

    ordered.forEach((entry, position) => {
      const earlier = ordered.slice(0, position);
      const phoneMatch = Boolean(entry.phone) && earlier.some((other) => other.phone === entry.phone);
      const addressMatch =
        Boolean(entry.address) &&
        earlier.some(
          (other) =>
            sameObject(entry, other) &&
            (!entry.city || !other.city || entry.city === other.city),
        );
      if (phoneMatch) byPhone = true;
      if (addressMatch) byAddress = true;

      index.set(entry.lead.id, {
        order: position + 1,
        total: ordered.length,
        previous: position > 0 ? ordered[position - 1].lead : null,
        byPhone: phoneMatch,
        byAddress: addressMatch,
      });
    });

    const fresh = [...ordered].reverse();
    groups.push({
      leads: fresh.map((entry) => entry.lead),
      latest: fresh[0].lead,
      byPhone,
      byAddress,
    });
  }

  // Свежие абоненты — первыми: так архив читается сверху вниз
  groups.sort((a, b) => timeOf(b.latest) - timeOf(a.latest));

  return { index, groups };
}

/**
 * Заявка вместе с историей обращений.
 *
 * Приложение передаёт её в открываемую форму заявки: так на экране видно, что
 * абонент обращается не первый раз, и когда был прошлый раз.
 */
export type WithRepeat<T extends RepeatLead> = T & { repeatInfo?: VisitInfo<T> };

/** «3-я» — подпись номера заявки у абонента. */
export function ordinalLabel(order: number): string {
  return `${order}-я`;
}

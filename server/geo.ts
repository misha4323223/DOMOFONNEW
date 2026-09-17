/**
 * Координаты адресов и линия маршрута — для карты внутри приложения.
 *
 * Работает на OpenStreetMap: ключей, кабинетов и счетов не нужно.
 *   • адрес → координаты: Nominatim (nominatim.openstreetmap.org)
 *   • линия маршрута, километры и время: OSRM (router.project-osrm.org)
 *
 * Правила этих сервисов (мы их соблюдаем):
 *   • не чаще одного запроса в секунду — запросы идут через serial();
 *   • приложение представляется в User-Agent;
 *   • результаты обязательно кэшировать — координаты лежат в key/value-таблице
 *     настроек (ключ geo:v2:<хэш адреса>), поэтому повторный адрес не ходит
 *     в сеть вообще, а второй телефон админа получает ответ мгновенно.
 *
 * Телефон наружу не ходит: вся работа с внешними сервисами — здесь, на сервере.
 *
 * Опыт прода (18.09.2026): адреса заявок пишут клиенты, а не карта — почти
 * всегда с квартирой («ул. Ленина, д. 5, кв. 12»). Поисковик на такую строку
 * отвечает «ничего не нашёл», и заявка пропадала с карты. Поэтому адрес перед
 * поиском чистится от квартиры/подъезда/этажа и ищется несколькими вариантами
 * (с городом, без номера дома, с областью) — до первого попадания в регион.
 */
import { createHash } from "crypto";
import { storage } from "./storage";

/** Больше точек в один запрос не берём: карта столько не покажет разумно. */
export const GEO_MAX_STOPS = 50;

/**
 * Сколько запросов к OpenStreetMap разрешено за один вызов.
 *
 * Адрес может искаться несколькими вариантами, поэтому считаем не адреса,
 * а именно запросы: их правило «не чаще 1 раза в секунду» — про запросы.
 * Не успевшие адреса возвращаются в remaining, приложение вызывает ещё раз.
 */
export const GEO_MAX_REQUESTS_PER_CALL = 6;

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";
/** Правила OSM требуют, чтобы клиент представился и оставил контакт. */
const USER_AGENT = "domofon-obzor71-admin/1.0 (+https://obzor71.ru)";
const REQUEST_TIMEOUT_MS = 12_000;
/** Пауза между запросами к внешним сервисам — их правило «не чаще 1 раза в сек». */
const MIN_REQUEST_INTERVAL_MS = 1100;
/** Сколько результатов смотреть: первый подходящий может быть и не первым. */
const NOMINATIM_LIMIT = 5;

/**
 * Регион обслуживания — тот же, что в приложении (mobile/src/city.ts).
 * Держим копию: сервер и приложение собираются отдельно, общий модуль
 * потянул бы нативные зависимости приложения на сервер.
 */
const SERVICE_REGION = "Тульская область";

/**
 * Границы региона обслуживания.
 *
 * Страховка оказалась необходимой: адрес без города («Ленина 5») поисковик
 * нашёл как «Ленина-5» в Златоусте Челябинской области — маршрут получился
 * 1827 км через Урал. Всё, что вне этих границ, считаем ненайденным: лучше
 * точка без координат, чем маршрут в другой регион.
 */
const REGION_BOUNDS = { minLat: 52.4, maxLat: 55.0, minLon: 35.5, maxLon: 39.5 };

/** Координаты внутри региона обслуживания? */
export function isInsideRegion(lat: number, lon: number): boolean {
  return (
    lat >= REGION_BOUNDS.minLat &&
    lat <= REGION_BOUNDS.maxLat &&
    lon >= REGION_BOUNDS.minLon &&
    lon <= REGION_BOUNDS.maxLon
  );
}

/**
 * v2 — потому что в v1 «не найдено» записывалось по нечищеному адресу
 * («…, кв. 12»), и такие ложные записи не должны мешать новой логике:
 * сменив префикс, мы их просто игнорируем.
 */
const CACHE_PREFIX = "geo:v2:";
const ROUTE_CACHE_PREFIX = "route:v1:";
/** Ограничение на память процесса: адресов у службы немного, но бережёмся. */
const MEMORY_LIMIT = 4000;

/**
 * Сколько живёт отметка «адрес не найден» — сутки.
 *
 * Раньше она была вечной, и это оказалось ловушкой: один неудачный поиск
 * (сеть отвалилась, вариант запроса был плохой) — и адрес не находился уже
 * никогда, сколько ни открывай карту. Сутки — компромисс: одну и ту же
 * неудачу не гоняем по сто раз на дню, но ошибка сама исправляется к утру.
 *
 * Важно: речь только про «не найдено». Исправленный в заявке адрес — это
 * другой адрес и другой ключ кэша, он ищется сразу же.
 */
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;

export type GeoPrecision = "house" | "street" | "unknown";

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Что нашлось — «5, улица Ленина, Щёкино…». Показываем администратору. */
  label: string;
  /** Насколько точно: дом / только улица / непонятно. */
  precision: GeoPrecision;
}

export interface GeoRoute {
  /** Длина маршрута в метрах. */
  distance: number;
  /** Время в пути в секундах. */
  duration: number;
  /** Точки линии маршрута: [широта, долгота] — так удобнее рисовать на карте. */
  geometry: [number, number][];
}

/** Точка маршрута, как её присылает приложение. */
export interface GeoStopInput {
  id: string;
  address: string;
  /** Город из заявки (его разбирает приложение) — сильно уточняет поиск. */
  city?: string;
}

export interface GeoStopResult {
  id: string;
  ok: boolean;
  lat: number | null;
  lon: number | null;
  label: string;
  precision: GeoPrecision;
}

export interface GeoPlanResult {
  stops: GeoStopResult[];
  route: GeoRoute | null;
  /** Сколько адресов ещё не найдено — приложение вызовет эндпоинт повторно. */
  remaining: number;
  /**
   * Сервис карт не ответил хотя бы по одному адресу. Это НЕ «адрес не найден»:
   * приложение говорит «нет связи с сервисом карт» и предлагает повторить,
   * вместо того чтобы отправлять администратора искать опечатку в заявке.
   */
  unavailable: boolean;
}

/** Сколько запросов к OSM ещё разрешено в этом вызове. */
interface Budget {
  left: number;
}

// --- Очередь запросов ------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/**
 * Выполнить запрос с соблюдением паузы между обращениями к внешним сервисам.
 * Через очередь, а не просто через setTimeout: параллельные вызовы не должны
 * «проскочить» вдвоём.
 */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// --- Кэш ------------------------------------------------------------------

/**
 * В памяти процесса держим только НАЙДЕННЫЕ адреса: у «не найдено» есть срок
 * годности, а его надо проверять по базе. Такой кэш живёт, пока контейнер
 * тёплый, и экономит самый частый случай — открыли карту второй раз.
 */
const memory = new Map<string, GeoPoint>();

function addressKey(query: string): string {
  return createHash("sha1")
    .update(query.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}

/** Прочитать кэш. undefined — записи нет (надо искать); null — искали, не нашли. */
async function readCache(key: string): Promise<GeoPoint | null | undefined> {
  const inMemory = memory.get(key);
  if (inMemory) return inMemory;
  try {
    const saved = await storage.getSetting(key);
    if (!saved) return undefined;
    const parsed = JSON.parse(saved.value) as { found?: boolean; at?: string } & Partial<GeoPoint>;
    if (!parsed.found) {
      const at = Date.parse(parsed.at ?? "");
      // Неудача ещё свежая — не мучаем OSM теми же адресами.
      if (!Number.isFinite(at) || Date.now() - at < NOT_FOUND_TTL_MS) return null;
      return undefined;
    }
    const point: GeoPoint = {
      lat: Number(parsed.lat),
      lon: Number(parsed.lon),
      label: String(parsed.label ?? ""),
      precision: (parsed.precision as GeoPrecision) ?? "unknown",
    };
    // Записи, сохранённые до появления проверки границ, тоже перечитываем.
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return undefined;
    if (!isInsideRegion(point.lat, point.lon)) return null;
    if (memory.size < MEMORY_LIMIT) memory.set(key, point);
    return point;
  } catch (err) {
    // База недоступна — не страшно: просто ищем в сети и работаем без кэша.
    console.error("[geo] Кэш координат недоступен:", err);
    return undefined;
  }
}

/** Записать кэш (в том числе «не найдено», но с датой — см. NOT_FOUND_TTL_MS). */
async function writeCache(key: string, point: GeoPoint | null): Promise<void> {
  if (point && memory.size < MEMORY_LIMIT) memory.set(key, point);
  const value = point
    ? JSON.stringify({
        found: true,
        lat: point.lat,
        lon: point.lon,
        label: point.label,
        precision: point.precision,
        at: new Date().toISOString(),
      })
    : JSON.stringify({ found: false, at: new Date().toISOString() });
  try {
    await storage.setSetting(key, value);
  } catch (err) {
    console.error("[geo] Не удалось сохранить координаты в кэш:", err);
  }
}

// --- Nominatim: адрес → координаты ----------------------------------------

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: { house_number?: string; road?: string; city?: string; town?: string };
}

/** Разобрать один ответ Nominatim. Вынесено отдельно — удобно проверять. */
export function parseNominatimHit(hit: NominatimHit | undefined): GeoPoint | null {
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;

  // Точность определяем по данным адреса: есть номер дома — значит дом.
  const hasHouse = Boolean(hit.address?.house_number);
  const hasStreet = Boolean(hit.address?.road);
  const precision: GeoPrecision = hasHouse ? "house" : hasStreet ? "street" : "unknown";

  return {
    lat,
    lon,
    label: (hit.display_name ?? "").trim(),
    precision,
  };
}

/**
 * Выбрать из ответа подходящую точку: только внутри нашего региона и,
 * если есть выбор, то с номером дома. Раньше брали самый первый результат —
 * и «Ленина 5» уезжало в Златоуст, а верное совпадение стояло вторым.
 */
export function pickNominatimHit(hits: NominatimHit[] | undefined): GeoPoint | null {
  if (!Array.isArray(hits)) return null;
  const inside = hits
    .map((hit) => parseNominatimHit(hit))
    .filter((point): point is GeoPoint => point !== null && isInsideRegion(point.lat, point.lon));
  if (inside.length === 0) return null;
  return inside.find((point) => point.precision === "house") ?? inside[0];
}

async function requestGeocode(query: string, budget: Budget): Promise<NominatimHit[]> {
  budget.left -= 1;
  const url =
    `${NOMINATIM_ENDPOINT}?format=jsonv2&limit=${NOMINATIM_LIMIT}` +
    `&addressdetails=1&accept-language=ru&q=` +
    encodeURIComponent(query);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Nominatim ${response.status}`);
  }
  const data = (await response.json()) as NominatimHit[];
  return Array.isArray(data) ? data : [];
}

// --- Чистка адреса и варианты запроса --------------------------------------

/**
 * Убрать из адреса то, чего в карте не бывает: квартиру, подъезд, этаж, офис.
 * Именно из-за них («ул. Ленина, д. 5, кв. 12») адрес и не находился.
 * Заодно снимаем пояснения в скобках («вход со двора»), кавычки,
 * разворачиваем сокращения («мкр.» → «микрорайон») и убираем «г.», «пос.».
 */
export function cleanAddressPart(value: string): string {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/[«»"']/g, " ")
    .replace(/(кв|квартира|подъезд|под|офис|этаж|эт|комната|ком|домофон|лифт)\s*\.?\s*\d+[а-я]?/gi, " ")
    .replace(/(^|[\s,])(г|гор|п|пос|с|д|дер|ст)\.\s*/gi, "$1")
    .replace(/(^|[\s,])мкр\.?\s*/gi, "$1микрорайон ")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/** Адрес без номера дома: «Щёкино, ул. Мира, 1» → «Щёкино, ул. Мира». */
function withoutHouse(address: string): string {
  return address
    .replace(/\b(д|дом)\.?\s*\d+[а-я]?\b/gi, " ")
    .replace(/\s+\d+[а-я]?\s*$/i, " ")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

/**
 * Варианты поискового запроса, от самого точного к самому общему.
 *
 * Один и тот же адрес карты понимают по-разному: где-то есть номер дома,
 * где-то только улица, где-то название микрорайона записано иначе. Поэтому
 * пробуем по очереди и останавливаемся на первом найденном.
 */
export function addressVariants(address: string, city?: string): string[] {
  const clean = cleanAddressPart(address);
  if (!clean) return [];
  const place = cleanAddressPart(city ?? "");
  // Город уже внутри адреса («Щёкино, ул. Ленина») — не дублируем его.
  const hasPlace = Boolean(place) && clean.toLowerCase().includes(place.toLowerCase());
  const withPlace = hasPlace ? clean : place ? `${place}, ${clean}` : `${SERVICE_REGION}, ${clean}`;

  const candidates = [withPlace, withoutHouse(withPlace), `${clean}, ${SERVICE_REGION}`];
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(value);
  }
  return variants;
}

// --- OSRM: линия маршрута, километры, время -------------------------------

interface OsrmResponse {
  code?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
  }[];
}

/** Разобрать ответ OSRM (координаты приходят [долгота, широта] — переворачиваем). */
export function parseOsrmRoute(data: OsrmResponse | undefined): GeoRoute | null {
  const route = data?.routes?.[0];
  if (!route) return null;
  const distance = Number(route.distance);
  const duration = Number(route.duration);
  if (!Number.isFinite(distance) || !Number.isFinite(duration)) return null;
  const geometry = (route.geometry?.coordinates ?? [])
    .filter((c) => Array.isArray(c) && c.length === 2)
    .map((c) => [Number(c[1]), Number(c[0])] as [number, number])
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
  return { distance, duration, geometry };
}

export async function buildRoute(
  points: { lat: number; lon: number }[],
): Promise<GeoRoute | null> {
  if (points.length < 2) return null;

  const coordinates = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const key = ROUTE_CACHE_PREFIX + addressKey(coordinates);

  try {
    const saved = await storage.getSetting(key);
    if (saved) {
      const parsed = parseOsrmRoute(JSON.parse(saved.value) as OsrmResponse);
      if (parsed) return parsed;
    }
  } catch (err) {
    console.error("[geo] Кэш маршрута недоступен:", err);
  }

  // overview=simplified — линия из десятков точек вместо тысяч: и по сети
  // быстро, и на карте выглядит ровно, и в кэш влезает.
  const url =
    `${OSRM_ENDPOINT}/${coordinates}?overview=simplified&geometries=geojson&steps=false`;
  const route = await serial(async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`OSRM ${response.status}`);
    return parseOsrmRoute((await response.json()) as OsrmResponse);
  });

  if (route) {
    try {
      await storage.setSetting(
        key,
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: route.distance,
              duration: route.duration,
              geometry: { coordinates: route.geometry.map(([lat, lon]) => [lon, lat]) },
            },
          ],
        }),
      );
    } catch (err) {
      console.error("[geo] Не удалось сохранить маршрут в кэш:", err);
    }
  }
  return route;
}

// --- Сборка ответа для приложения -----------------------------------------

function emptyStop(id: string): GeoStopResult {
  return { id, ok: false, lat: null, lon: null, label: "", precision: "unknown" };
}

function stopFromPoint(id: string, point: GeoPoint | null): GeoStopResult {
  if (!point) return emptyStop(id);
  return {
    id,
    ok: true,
    lat: point.lat,
    lon: point.lon,
    label: point.label,
    precision: point.precision,
  };
}

/**
 * Превратить список точек маршрута в координаты и линию.
 *
 * Тонкость первая: свежие адреса ищутся по правилам OSM — не чаще запроса
 * в секунду, поэтому за один вызов делается не больше GEO_MAX_REQUESTS_PER_CALL
 * запросов, а в ответе сообщается, сколько осталось (remaining). Приложение
 * вызывает эндпоинт ещё раз: найденное берётся из кэша мгновенно, и точки
 * появляются постепенно, а не через полминуты ожидания.
 *
 * Тонкость вторая: «адрес не найден» и «сервис не ответил» — разные вещи.
 * Первое кэшируем (с датой), второе — нет, и говорим приложению честно.
 */
export async function resolveGeoPlan(
  input: GeoStopInput[],
  options: { refresh?: boolean } = {},
): Promise<GeoPlanResult> {
  const stops = input.slice(0, GEO_MAX_STOPS);
  const budget: Budget = { left: GEO_MAX_REQUESTS_PER_CALL };
  const results: GeoStopResult[] = [];
  let remaining = 0;
  let lookups = 0;
  let notFound = 0;
  let failures = 0;

  for (const stop of stops) {
    const variants = addressVariants(stop.address, stop.city);
    if (variants.length === 0) {
      results.push(emptyStop(stop.id));
      continue;
    }

    // Кэш — по самому точному варианту: найденное (или «не найдено») храним
    // один раз на адрес, сколько бы вариантов ни пробовали.
    const key = CACHE_PREFIX + addressKey(variants[0]);
    const cached = await readCache(key);
    // refresh — это ручное «Повторить»: пометку «не найдено» не уважаем
    // (за ней может стоять разовая неудача), а найденное берём как обычно.
    const skipCache = options.refresh === true && cached === null;
    if (cached !== undefined && !skipCache) {
      if (cached === null) notFound += 1;
      results.push(stopFromPoint(stop.id, cached));
      continue;
    }

    if (budget.left <= 0) {
      // Лимит запросов исчерпан — попросим приложение повторить запрос.
      remaining += 1;
      results.push(emptyStop(stop.id));
      continue;
    }

    let point: GeoPoint | null = null;
    let serviceFailed = false;
    for (const query of variants) {
      if (budget.left <= 0) break;
      lookups += 1;
      try {
        const hits = await serial(() => requestGeocode(query, budget));
        point = pickNominatimHit(hits);
      } catch (err) {
        // Сеть/сервис — это не «адрес плохой», и в кэш такое не пишем.
        serviceFailed = true;
        console.error("[geo] Сервис карт не ответил на запрос:", query, err);
        break;
      }
      if (point) {
        console.log(
          `[geo] «${variants[0]}» → ${point.precision === "house" ? "дом" : "улица/район"} (${query})`,
        );
        break;
      }
    }

    if (!point && serviceFailed) {
      failures += 1;
      remaining += 1;
      results.push(emptyStop(stop.id));
      continue;
    }
    if (!point && budget.left <= 0) {
      // Не успели перебрать варианты — оставим адрес на следующий вызов.
      remaining += 1;
      results.push(emptyStop(stop.id));
      continue;
    }

    if (!point) {
      notFound += 1;
      console.log(`[geo] «${variants[0]}» → не найдено (пробовали ${variants.length} вариант(а))`);
    }
    await writeCache(key, point);
    results.push(stopFromPoint(stop.id, point));
  }

  const found = results.filter(
    (r): r is GeoStopResult & { lat: number; lon: number } => r.lat !== null && r.lon !== null,
  );
  let route: GeoRoute | null = null;
  if (found.length >= 2 && remaining === 0) {
    try {
      route = await buildRoute(found.map((r) => ({ lat: r.lat, lon: r.lon })));
    } catch (err) {
      console.error("[geo] Не удалось построить маршрут:", err);
    }
  }

  if (lookups > 0) {
    console.log(
      `[geo] план: точек ${results.length}, найдено ${found.length}, не найдено ${notFound}, ` +
        `запросов ${lookups}, недоступно ${failures}`,
    );
  }

  return { stops: results, route, remaining, unavailable: failures > 0 };
}

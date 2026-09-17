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
 *     настроек (ключ geo:v1:<хэш адреса>), поэтому повторный адрес не ходит
 *     в сеть вообще, а второй телефон админа получает ответ мгновенно.
 *
 * Телефон наружу не ходит: вся работа с внешними сервисами — здесь, на сервере.
 */
import { createHash } from "crypto";
import { storage } from "./storage";

/** Больше точек в один запрос не берём: карта столько не покажет разумно. */
export const GEO_MAX_STOPS = 50;

/** Сколько НОВЫХ адресов разрешено искать за один вызов (см. комментарий ниже). */
export const GEO_MAX_NEW_PER_CALL = 5;

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const OSRM_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";
/** Правила OSM требуют, чтобы клиент представился и оставил контакт. */
const USER_AGENT = "domofon-obzor71-admin/1.0 (+https://obzor71.ru)";
const REQUEST_TIMEOUT_MS = 12_000;
/** Пауза между запросами к внешним сервисам — их правило «не чаще 1 раза в сек». */
const MIN_REQUEST_INTERVAL_MS = 1100;

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

const CACHE_PREFIX = "geo:v1:";
const ROUTE_CACHE_PREFIX = "route:v1:";
/** Ограничение на память процесса: адресов у службы немного, но бережёмся. */
const MEMORY_LIMIT = 4000;

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

const memory = new Map<string, GeoPoint | null>();

function addressKey(query: string): string {
  return createHash("sha1")
    .update(query.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}

/** Прочитать кэш. undefined — записи нет; null — адрес уже искали и не нашли. */
async function readCache(key: string): Promise<GeoPoint | null | undefined> {
  if (memory.has(key)) return memory.get(key);
  try {
    const saved = await storage.getSetting(key);
    if (!saved) return undefined;
    const parsed = JSON.parse(saved.value) as { found?: boolean } & Partial<GeoPoint>;
    const point: GeoPoint | null = parsed.found
      ? {
          lat: Number(parsed.lat),
          lon: Number(parsed.lon),
          label: String(parsed.label ?? ""),
          precision: (parsed.precision as GeoPrecision) ?? "unknown",
        }
      : null;
    // Записи, сохранённые до появления проверки границ, тоже перечитываем.
    if (point && !isInsideRegion(point.lat, point.lon)) return null;
    if (memory.size < MEMORY_LIMIT) memory.set(key, point);
    return point;
  } catch (err) {
    // База недоступна — не страшно: просто ищем в сети и работаем без кэша.
    console.error("Кэш координат недоступен:", err);
    return undefined;
  }
}

/** Записать кэш (в том числе «не найдено», чтобы не искать адрес заново). */
async function writeCache(key: string, point: GeoPoint | null): Promise<void> {
  if (memory.size < MEMORY_LIMIT) memory.set(key, point);
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
    console.error("Не удалось сохранить координаты в кэш:", err);
  }
}

// --- Nominatim: адрес → координаты ----------------------------------------

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: { house_number?: string; road?: string; city?: string; town?: string };
}

/** Разобрать ответ Nominatim. Вынесено отдельно — удобно проверять. */
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

async function requestGeocode(query: string): Promise<GeoPoint | null> {
  const url =
    `${NOMINATIM_ENDPOINT}?format=jsonv2&limit=1&addressdetails=1&accept-language=ru&q=` +
    encodeURIComponent(query);
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Nominatim ${response.status}`);
  }
  const data = (await response.json()) as NominatimHit[];
  const point = parseNominatimHit(Array.isArray(data) ? data[0] : undefined);
  if (!point) return null;
  // Нашлось, но в другом регионе — считаем, что не нашли (см. REGION_BOUNDS).
  if (!isInsideRegion(point.lat, point.lon)) return null;
  return point;
}

/**
 * Найти координаты по тексту адреса. null — адрес не найден.
 * При сбое сети бросает ошибку: «не нашли» и «не смогли спросить» — разные вещи,
 * и неудачу нельзя записывать в кэш как «адреса нет».
 */
export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const clean = query.replace(/\s+/g, " ").trim();
  if (!clean) return null;

  const key = CACHE_PREFIX + addressKey(clean);
  const cached = await readCache(key);
  if (cached !== undefined) return cached;

  const point = await serial(() => requestGeocode(clean));
  await writeCache(key, point);
  return point;
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
    console.error("Кэш маршрута недоступен:", err);
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
      console.error("Не удалось сохранить маршрут в кэш:", err);
    }
  }
  return route;
}

// --- Сборка ответа для приложения -----------------------------------------

/** Запрос к картам: город (если понятен) + адрес + регион для подстраховки. */
export function buildGeoQuery(address: string, city?: string): string {
  const street = address.replace(/\s+/g, " ").trim();
  const place = (city ?? "").replace(/\s+/g, " ").trim();
  if (!street) return "";
  const inStreet = place && street.toLowerCase().includes(place.toLowerCase());
  if (!inStreet) {
    // Город ставим перед адресом («Богородицк, ул. Ленина 5»), а если города
    // нет — подставляем регион: иначе поиск уводит в другой регион России.
    return `${place || SERVICE_REGION}, ${street}`;
  }
  // Город уже внутри адреса — добавим регион, только если его там ещё нет.
  return /тульск/i.test(street) ? street : `${street}, ${SERVICE_REGION}`;
}

/**
 * Превратить список точек маршрута в координаты и линию.
 *
 * Важная тонкость: свежие адреса ищутся по правилам OSM — по одному в секунду,
 * поэтому за один вызов разбираем не больше GEO_MAX_NEW_PER_CALL новых
 * адресов, а в ответе сообщаем, сколько осталось (remaining). Приложение
 * просто вызывает эндпоинт ещё раз: уже найденное берётся из кэша мгновенно,
 * и точки на карте появляются постепенно, а не через полминуты ожидания.
 */
export async function resolveGeoPlan(input: GeoStopInput[]): Promise<GeoPlanResult> {
  const stops = input.slice(0, GEO_MAX_STOPS);
  const results: GeoStopResult[] = [];
  let newLookups = 0;
  let remaining = 0;

  for (const stop of stops) {
    const query = buildGeoQuery(stop.address, stop.city);
    if (!query) {
      results.push({
        id: stop.id,
        ok: false,
        lat: null,
        lon: null,
        label: "",
        precision: "unknown",
      });
      continue;
    }

    const key = CACHE_PREFIX + addressKey(query);
    // readCache сам кладёт результат в память процесса, повторно её не читаем.
    const cached = await readCache(key);
    if (cached === undefined && newLookups >= GEO_MAX_NEW_PER_CALL) {
      // Бюджет новых поисков исчерпан — попросим приложение повторить запрос.
      remaining += 1;
      continue;
    }
    if (cached === undefined) newLookups += 1;

    let point: GeoPoint | null;
    try {
      point = await geocodeAddress(query);
    } catch (err) {
      console.error("Не удалось найти адрес:", query, err);
      point = null;
    }

    results.push({
      id: stop.id,
      ok: point !== null,
      lat: point?.lat ?? null,
      lon: point?.lon ?? null,
      label: point?.label ?? "",
      precision: point?.precision ?? "unknown",
    });
  }

  const found = results.filter(
    (r): r is GeoStopResult & { lat: number; lon: number } =>
      r.lat !== null && r.lon !== null,
  );
  let route: GeoRoute | null = null;
  if (found.length >= 2 && remaining === 0) {
    try {
      route = await buildRoute(found.map((r) => ({ lat: r.lat, lon: r.lon })));
    } catch (err) {
      console.error("Не удалось построить маршрут:", err);
    }
  }

  return { stops: results, route, remaining };
}

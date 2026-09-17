/**
 * Маршрут на день: порядок объезда заявок и хранение плана.
 *
 * Заявки выстраиваются автоматически: сначала город (порядок городов —
 * SERVICE_CITIES: Богородицк, Щёкино, Ефремов, он же порядок выезда),
 * внутри города — по улице, потом по номеру дома. Так маршрут не «прыгает»
 * по области, а идёт по городу подряд.
 *
 * Адрес в заявке — свободный текст, координат у нас нет, поэтому улица и дом
 * вытаскиваются из строки адреса простым разбором (см. addressParts).
 *
 * План лежит в двух местах: на сервере (общий для всех телефонов, переживает
 * переустановку) и в телефоне (чтобы маршрут работал без интернета). При
 * запуске выбираем ту версию, что менялась позже (см. syncRoutePlan).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  api,
  emptyRoutePlan,
  normalizeRoutePlan,
  type Lead,
  type RoutePlan,
} from "./api";
import { SERVICE_CITIES, leadCity } from "./maps";

const LOCAL_KEY = "route_plan";

/** Привести строку к виду для сравнения: нижний регистр, «ё» → «е». */
function forSearch(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

/**
 * Слова, которые в адресе не название улицы: тип улицы и «дом/квартира».
 * В сравнении они не участвуют, поэтому «ул. Ленина 5» и «Ленина 5» — одно.
 */
const NOISE_WORDS = new Set([
  "ул",
  "улица",
  "пер",
  "переулок",
  "пр",
  "проезд",
  "пр-т",
  "проспект",
  "шоссе",
  "ш",
  "пл",
  "площадь",
  "туп",
  "тупик",
  "мкр",
  "микрорайон",
  "кв",
  "квартира",
  "д",
  "дом",
  "корп",
  "корпус",
  "стр",
  "строение",
  "п",
  "пос",
  "поселок",
  "рп",
  "с",
  "село",
  "нп",
  // Город и район: «г. Щёкино», «Тульская обл.» — это не улица
  "г",
  "гор",
  "обл",
  "область",
  "р-н",
  "район",
  "г.о",
]);

/** Номер дома: только цифры с необязательной буквой («5», «12а»). */
const HOUSE_RE = /^(\d+[а-яa-z]?)$/;

/** Улица и дом из свободной строки адреса. */
export function addressParts(address: string): { street: string; house: number | null } {
  // Знаки в «ул. Ленина, д. 5» мешают разбору — меняем их на пробелы
  let text = forSearch(address)
    .replace(/[.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Город сравнивать не нужно: он уже разводит заявки по группам
  for (const city of SERVICE_CITIES) {
    text = text.split(forSearch(city)).join(" ");
  }
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

  const street: string[] = [];
  let house: number | null = null;
  for (const word of words) {
    if (NOISE_WORDS.has(word)) continue;
    const houseMatch = HOUSE_RE.exec(word);
    if (houseMatch) {
      // Первое число в адресе — дом, остальные (корпус, квартира) не важны
      if (house === null) house = Number(houseMatch[1].replace(/[^\d]/g, ""));
      continue;
    }
    if (street.length < 4) street.push(word);
  }

  return { street: street.join(" ") || text.trim(), house };
}

/** Известный город заявки: номер группы в порядке объезда (неизвестный — в конец). */
export function cityRank(lead: Lead): number {
  const city = leadCity(lead);
  const index = city ? SERVICE_CITIES.indexOf(city) : -1;
  return index === -1 ? SERVICE_CITIES.length : index;
}

/** Название города для заголовка группы в списке. */
export function leadCityLabel(lead: Lead): string {
  return leadCity(lead) ?? "Другие адреса";
}

/** Сравнение двух заявок для порядка объезда. */
export function compareForRoute(a: Lead, b: Lead): number {
  const rank = cityRank(a) - cityRank(b);
  if (rank !== 0) return rank;

  const pa = addressParts(a.address);
  const pb = addressParts(b.address);
  const street = pa.street.localeCompare(pb.street, "ru");
  if (street !== 0) return street;

  if (pa.house !== pb.house) {
    // Адреса без номера дома — в конец улицы
    if (pa.house === null) return 1;
    if (pb.house === null) return -1;
    return pa.house - pb.house;
  }

  return (a.createdAt || "").localeCompare(b.createdAt || "");
}

/** Заявки в порядке объезда. */
export function sortLeadsForRoute(leads: Lead[]): Lead[] {
  return [...leads].sort(compareForRoute);
}

/** Разложить по городам — для списка выбора с заголовками. */
export function groupByCity(leads: Lead[]): { city: string; leads: Lead[] }[] {
  const sorted = sortLeadsForRoute(leads);
  const groups: { city: string; leads: Lead[] }[] = [];
  for (const lead of sorted) {
    const city = leadCityLabel(lead);
    const last = groups[groups.length - 1];
    if (last && last.city === city) last.leads.push(lead);
    else groups.push({ city, leads: [lead] });
  }
  return groups;
}

/** Сколько в плане выполненных заявок (по статусу самой заявки). */
export function routeProgress(plan: RoutePlan, leads: Lead[]): number {
  const byId = new Map(leads.map((l) => [l.id, l]));
  return plan.stops.filter((id) => byId.get(id)?.status === "done").length;
}

/** Текущая точка маршрута — первая невыполненная заявка. */
export function currentStopId(plan: RoutePlan, leads: Lead[]): string | null {
  const byId = new Map(leads.map((l) => [l.id, l]));
  for (const id of plan.stops) {
    if (byId.get(id)?.status !== "done") return id;
  }
  return null;
}

/**
 * Сделать заявку следующей в маршруте.
 *
 * Двигаем её на место текущей точки: тогда «сделал — поехал дальше» работает
 * и когда мастер решил заехать в другую заявку раньше.
 */
export function moveStopToCurrent(plan: RoutePlan, leads: Lead[], id: string): string[] {
  const current = currentStopId(plan, leads);
  if (!current || current === id) return plan.stops;
  const rest = plan.stops.filter((stopId) => stopId !== id);
  const index = rest.indexOf(current);
  if (index === -1) return plan.stops;
  rest.splice(index, 0, id);
  return rest;
}

/**
 * Можно ли сдвинуть точку на шаг вверх (-1) или вниз (+1).
 *
 * Нельзя: сдвинуть выполненную точку, поменять её местами с выполненной,
 * выйти за пределы списка. По этому правилу приложение гасит стрелки.
 */
export function canMoveStop(
  plan: RoutePlan,
  leads: Lead[],
  id: string,
  direction: -1 | 1,
): boolean {
  const index = plan.stops.indexOf(id);
  if (index === -1) return false;
  const target = index + direction;
  if (target < 0 || target >= plan.stops.length) return false;
  const byId = new Map(leads.map((l) => [l.id, l]));
  if (byId.get(id)?.status === "done") return false;
  return byId.get(plan.stops[target])?.status !== "done";
}

/**
 * Двинуть точку вверх или вниз по порядку объезда.
 *
 * Сортировка по городам и улицам — только подсказка: мастер знает дорогу
 * лучше, поэтому порядок можно поправить вручную, меняя точку с соседней
 * стрелками ↑↓. Выполненные точки остаются на своих местах, иначе пройденное
 * «уехало» бы вниз и текущая точка потерялась бы.
 */
export function moveStop(
  plan: RoutePlan,
  leads: Lead[],
  id: string,
  direction: -1 | 1,
): string[] {
  if (!canMoveStop(plan, leads, id, direction)) return plan.stops;
  const index = plan.stops.indexOf(id);
  const target = index + direction;
  const stops = [...plan.stops];
  stops[index] = stops[target];
  stops[target] = id;
  return stops;
}

/**
 * Добавить заявку в уже начатый маршрут — следующей точкой после текущей.
 *
 * Мастер уже в рейсе, но поступила заявка по пути: она должна встать сразу
 * после текущей точки, а не в конец — «закрою эту и заеду по дороге».
 * Если текущей точки нет (маршрут пройден) — просто в конец.
 */
export function insertStopAfterCurrent(
  plan: RoutePlan,
  leads: Lead[],
  id: string,
): string[] {
  if (plan.stops.includes(id)) return plan.stops;
  const current = currentStopId(plan, leads);
  const index = current ? plan.stops.indexOf(current) : -1;
  if (index === -1) return [...plan.stops, id];
  const next = [...plan.stops];
  next.splice(index + 1, 0, id);
  return next;
}

/** Пропустить текущую точку: уходит в конец маршрута. */
export function skipCurrentStop(plan: RoutePlan, leads: Lead[]): string[] {
  const current = currentStopId(plan, leads);
  if (!current) return plan.stops;
  return [...plan.stops.filter((id) => id !== current), current];
}

// --- Хранение плана: телефон + сервер ---

/** Прочитать план из хранилища телефона. */
export async function loadLocalRoute(): Promise<RoutePlan> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    if (!raw) return emptyRoutePlan();
    return normalizeRoutePlan(JSON.parse(raw));
  } catch {
    return emptyRoutePlan();
  }
}

/** Сохранить план в телефоне (маршрут должен работать и без интернета). */
export async function saveLocalRoute(plan: RoutePlan): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(plan));
  } catch {
    // Хранилище недоступно — маршрут просто не переживёт перезапуск
  }
}

/**
 * Сверить план с сервером и вернуть тот, что актуальнее.
 *
 * Локальный план главнее, пока он не пустой: его только что собирали в
 * приложении. Если же в телефоне пусто (переустановка, новый админ) —
 * забираем маршрут с сервера.
 */
export async function syncRoutePlan(token: string, local: RoutePlan): Promise<RoutePlan> {
  try {
    const remote = normalizeRoutePlan(await api.route(token));
    const localTime = Date.parse(local.updatedAt || "") || 0;
    const remoteTime = Date.parse(remote.updatedAt || "") || 0;
    if (local.stops.length > 0 && localTime >= remoteTime) {
      return await pushRoutePlan(token, local);
    }
    await saveLocalRoute(remote);
    return remote;
  } catch {
    // Офлайн — работаем с тем, что лежит в телефоне
    return local;
  }
}

/**
 * Сохранить план: сначала в телефоне, потом на сервере.
 * false — сервер не ответил (офлайн); план останется локальным.
 */
export async function pushRoutePlan(token: string, plan: RoutePlan): Promise<RoutePlan> {
  await saveLocalRoute(plan);
  try {
    const saved = normalizeRoutePlan(await api.saveRoute(token, plan));
    await saveLocalRoute(saved);
    return saved;
  } catch {
    return plan;
  }
}

/** Новый план с отметкой времени «сейчас». */
export function touchRoutePlan(
  stops: string[],
  startedAt: string | null,
): RoutePlan {
  return { stops, startedAt, updatedAt: new Date().toISOString() };
}

/**
 * Поездка по маршруту: то, что должно переживать перезапуск приложения.
 *
 * Здесь живут четыре вещи:
 *  1) состояние поездки — когда начали, сколько проехали, сколько точек
 *     закрыли. Оно лежит на телефоне, поэтому закрытое (или упавшее)
 *     приложение не теряет смену: при возврате карта предлагает продолжить;
 *  2) итоги смены — «7 точек · 68 км»;
 *  3) текст сообщения клиенту («мастер будет примерно через 12 минут»);
 *  4) адрес базы (куда возвращаться после маршрута).
 *
 * Расчёт пробега и тексты — чистые функции без React Native: их проверяем
 * по отдельности, а экран карты остаётся про карту. Хранение — AsyncStorage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { GeoRideRoute } from "./api";

const RIDE_KEY = "ride_session";
const BASE_KEY = "ride_base";

/** Скачок GPS больше этого — сбой определения, а не пробег. */
export const RIDE_JUMP_METERS = 2000;
/** Мельче этого не считаем: шум GPS на стоянке. */
export const RIDE_MIN_STEP_METERS = 15;
/** Поездку старше этого срока после перезапуска не поднимаем (забытая смена). */
export const RIDE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/**
 * id точки базы в расчёте дороги. Такого id нет и не может быть у заявки
 * (в базе — uuid), поэтому его видно отдельно от рабочих точек.
 */
export const BASE_POINT_ID = "base-home";

export interface RideSession {
  /** Когда начали поездку (ISO). */
  startedAt: string;
  /** Пробег за поездку, метры. */
  meters: number;
  /** Сколько точек закрыли в этой поездке. */
  completed: number;
  /** Последнее известное положение — чтобы продолжить, не дожидаясь GPS. */
  lat: number | null;
  lon: number | null;
  /** Когда состояние обновляли (ISO) — по нему отсекаем забытые поездки. */
  updatedAt: string;
}

/** Адрес базы: куда возвращаться после маршрута. */
export interface RideBase {
  address: string;
  lat: number | null;
  lon: number | null;
}

function timeOf(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

/** Новая поездка: пробег с нуля. */
export function newRideSession(now: number = Date.now()): RideSession {
  return {
    startedAt: new Date(now).toISOString(),
    meters: 0,
    completed: 0,
    lat: null,
    lon: null,
    updatedAt: new Date(now).toISOString(),
  };
}

/**
 * Дописать пробег от одной точки положения до другой.
 *
 * Мелкие смещения (шум GPS на стоянке) и огромные скачки (телефон «прыгнул»
 * на другой конец области) в пробег не идут: иначе итоги смены врут.
 */
export function withDistance(
  session: RideSession,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  meters: number,
  now: number = Date.now(),
): RideSession {
  const moved = meters;
  const counted =
    moved >= RIDE_MIN_STEP_METERS && moved <= RIDE_JUMP_METERS ? moved : 0;
  return {
    ...session,
    meters: session.meters + counted,
    lat: to.lat,
    lon: to.lon,
    updatedAt: new Date(now).toISOString(),
  };
}

/** Поездка ещё актуальна: не старше смены. */
export function isRideFresh(session: RideSession, now: number = Date.now()): boolean {
  const at = timeOf(session.updatedAt) || timeOf(session.startedAt);
  if (!at) return false;
  return now - at < RIDE_MAX_AGE_MS;
}

/** «7 точек · 68 км» — итоги смены одной строкой. */
export function rideSummary(session: RideSession): string {
  const km = formatRideKm(session.meters);
  return km ? `${formatPoints(session.completed)} · ${km}` : formatPoints(session.completed);
}

/** «8 точек» / «1 точка» / «2 точки». */
export function formatPoints(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} точка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} точки`;
  return `${count} точек`;
}

/** «68 км» или «400 м»; пусто, если ещё не двинулись. */
export function formatRideKm(meters: number): string {
  if (meters < 1000) return meters < 100 ? "" : `${Math.round(meters)} м`;
  const km = meters / 1000;
  return `${km < 10 ? (Math.round(km * 10) / 10).toString().replace(".", ",") : Math.round(km)} км`;
}

/** Во сколько начали поездку: «в 9:41». */
export function rideStartedLabel(session: RideSession): string {
  const at = new Date(session.startedAt);
  if (Number.isNaN(at.getTime())) return "";
  const hours = at.getHours().toString().padStart(2, "0");
  const minutes = at.getMinutes().toString().padStart(2, "0");
  return `в ${hours}:${minutes}`;
}

/**
 * Текст клиенту: «мастер будет примерно через 12 минут».
 *
 * Ничего лишнего и без обещаний точности: если время неизвестно, пишем, что
 * мастер уже выехал — так честнее, чем называть цифру наугад.
 */
export function messageForClient(etaSeconds: number | null): string {
  if (etaSeconds === null) return "Здравствуйте! Мастер выехал к вам.";
  const minutes = Math.max(1, Math.round(etaSeconds / 60));
  if (minutes <= 1) return "Здравствуйте! Мастер будет через минуту.";
  const mod10 = minutes % 10;
  const mod100 = minutes % 100;
  const unit =
    mod10 === 1 && mod100 !== 11
      ? "минуту"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)
        ? "минуты"
        : "минут";
  return `Здравствуйте! Мастер будет примерно через ${minutes} ${unit}.`;
}

/**
 * Коротко для кнопки: «буду через 12 мин» / «уже в пути».
 *
 * Полный текст клиенту собирает messageForClient; здесь — только подпись,
 * чтобы техник видел, что именно уйдёт клиенту, не открывая сообщение.
 */
export function etaShortLabel(etaSeconds: number | null): string {
  if (etaSeconds === null) return "уже в пути";
  return `буду через ${Math.max(1, Math.round(etaSeconds / 60))} мин`;
}

/**
 * Разделить итоги дорожного маршрута на работу и дорогу до базы.
 *
 * Когда база включена в расчёт, последний участок ведёт домой: его нельзя
 * прибавлять к «весь остаток» по заявкам, иначе смена «не заканчивается».
 */
export function rideTotals(road: GeoRideRoute | null): {
  work: { distance: number; duration: number };
  home: { distance: number; duration: number } | null;
} {
  if (!road) return { work: { distance: 0, duration: 0 }, home: null };
  const legs = road.legs ?? [];
  const homeLeg = legs.find((leg) => leg.id === BASE_POINT_ID);
  if (!homeLeg) {
    return { work: { distance: road.distance, duration: road.duration }, home: null };
  }
  let distance = 0;
  let duration = 0;
  for (const leg of legs) {
    if (leg.id === BASE_POINT_ID) continue;
    distance += leg.distance;
    duration += leg.duration;
  }
  return {
    work: { distance, duration },
    home: { distance: homeLeg.distance, duration: homeLeg.duration },
  };
}

// --- Хранение на телефоне ---

export async function loadRideSession(): Promise<RideSession | null> {
  try {
    const raw = await AsyncStorage.getItem(RIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RideSession>;
    if (!parsed?.startedAt) return null;
    const session: RideSession = {
      startedAt: parsed.startedAt,
      meters: typeof parsed.meters === "number" ? parsed.meters : 0,
      completed: typeof parsed.completed === "number" ? parsed.completed : 0,
      lat: typeof parsed.lat === "number" ? parsed.lat : null,
      lon: typeof parsed.lon === "number" ? parsed.lon : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : parsed.startedAt,
    };
    return isRideFresh(session) ? session : null;
  } catch {
    return null;
  }
}

export async function saveRideSession(session: RideSession): Promise<void> {
  try {
    await AsyncStorage.setItem(RIDE_KEY, JSON.stringify(session));
  } catch {
    // Хранилище недоступно — поездка просто не переживёт перезапуск
  }
}

export async function clearRideSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RIDE_KEY);
  } catch {
    // не критично
  }
}

export async function loadRideBase(): Promise<RideBase> {
  try {
    const raw = await AsyncStorage.getItem(BASE_KEY);
    if (!raw) return { address: "", lat: null, lon: null };
    const parsed = JSON.parse(raw) as Partial<RideBase>;
    return {
      address: typeof parsed.address === "string" ? parsed.address : "",
      lat: typeof parsed.lat === "number" ? parsed.lat : null,
      lon: typeof parsed.lon === "number" ? parsed.lon : null,
    };
  } catch {
    return { address: "", lat: null, lon: null };
  }
}

export async function saveRideBase(base: RideBase): Promise<void> {
  try {
    await AsyncStorage.setItem(BASE_KEY, JSON.stringify(base));
  } catch {
    // не критично
  }
}

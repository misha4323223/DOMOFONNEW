/**
 * Чистая арифметика поездки — без React, карт и телефона.
 *
 * Здесь только то, что можно проверить тестом: насколько близко точка, идти
 * ли это движение в счёт пробега, стоит ли уже сообщать «вы на месте» и как
 * превратить записанный телефон в номер для звонка. Всё остальное (служба
 * определения, уведомления) живёт в rideTrack.ts и опирается на эти функции.
 */
import { RIDE_JUMP_METERS, RIDE_MIN_STEP_METERS } from "./ride";

/** С какого расстояния считаем, что мастер приехал. */
export const ARRIVAL_RADIUS_M = 200;

/** Номер в вид 7XXXXXXXXXX; пусто — звонить некуда. */
export function phoneDigits(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 11 ? digits : "";
}

/** Расстояние по прямой между двумя точками, в метрах; null — считать нечего. */
export function metersToStop(
  fix: { lat: number; lon: number } | null,
  stop: { lat: number; lon: number } | null,
): number | null {
  if (!fix || !stop) return null;
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (stop.lat - fix.lat) * rad;
  const dLon = (stop.lon - fix.lon) * rad;
  const la1 = fix.lat * rad;
  const la2 = stop.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Что делать с новым положением: считать ли это движение пробегом и пора ли
 * говорить о приезде.
 *
 * Шум GPS на стоянке (пара метров) и «прыжок» на другой конец области (телефон
 * потерял спутники) в пробег не идут, иначе итоги смены врут. О приезде
 * сообщаем один раз на точку — иначе уведомление сыпалось бы каждые пять секунд.
 */
export function rideFixDecision(params: {
  moved: number;
  left: number | null;
  stopId: string;
  announcedFor: string | null;
}): { countMeters: boolean; notify: boolean } {
  const countMeters =
    params.moved >= RIDE_MIN_STEP_METERS && params.moved <= RIDE_JUMP_METERS;
  const notify =
    params.left !== null &&
    params.left <= ARRIVAL_RADIUS_M &&
    params.announcedFor !== params.stopId;
  return { countMeters, notify };
}

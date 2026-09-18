/**
 * Вспомогательное для карты: чистые функции и защита от падения.
 *
 * Вынесено из MapScreen, чтобы экран карты оставался про карту, а расчёты
 * и мелкие помощники можно было проверить по отдельности.
 */
import { Component, type ReactNode } from "react";

/** Ничего лишнего в скрипт не попадёт: кавычки и угловые скобки экранируем. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028|\u2029/g, "");
}

/** Ошибку отрисовки карты не даём уронить всё приложение. */
export class MapErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** «1 точка», «2 точки», «5 точек» — как принято по-русски. */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** Расстояние по прямой между двумя точками, в метрах. */
export function metersBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const la1 = a.lat * rad;
  const la2 = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Где машина относительно линии: насколько отклонилась и сколько линии
 * осталось впереди. Считаем на телефоне — из-за этого сервер не дёргаем.
 */
export function progressOnRoute(
  geometry: [number, number][],
  me: { lat: number; lon: number } | null,
): { offRoute: number; ahead: number } | null {
  if (!me || geometry.length < 2) return null;
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < geometry.length; i += 1) {
    const d = metersBetween({ lat: geometry[i][0], lon: geometry[i][1] }, me);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  let ahead = 0;
  for (let i = bestIdx; i < geometry.length - 1; i += 1) {
    ahead += metersBetween(
      { lat: geometry[i][0], lon: geometry[i][1] },
      { lat: geometry[i + 1][0], lon: geometry[i + 1][1] },
    );
  }
  return { offRoute: bestDist, ahead };
}

export const NO_WEBVIEW_HINT =
  "Карта появится после обновления приложения: эта сборка ещё не умеет показывать карты внутри себя. Скачайте новую версию APK — и карта заработает.";

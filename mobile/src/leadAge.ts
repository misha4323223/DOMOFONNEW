/**
 * Возраст заявки и предупреждение о «зависших» заявках.
 *
 * Заявка, которая больше недели лежит невыполненной, — это забытый клиент.
 * Логика вынесена из экранов отдельным модулем, чтобы список заявок и форма
 * редактирования предупреждали одинаково.
 */

/** Через сколько дней заявка считается «зависшей». */
export const STALE_DAYS = 7;

/** Второй порог: заявка висит уже две недели — клиент почти потерян. */
export const CRITICAL_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StaleInfo {
  /** Сколько полных дней заявка уже открыта. */
  days: number;
  /** warn — больше недели, critical — больше двух недель. */
  level: "warn" | "critical";
  /** Готовая подпись для карточки: «висит 9 дней». */
  text: string;
}

/** Склонение существительного по числу: (3, «день», «дня», «дней»). */
export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Склонение слова «заявка» для числа: 1 заявка, 3 заявки, 11 заявок. */
export function leadsWord(n: number): string {
  return plural(n, "заявка", "заявки", "заявок");
}

/** Сколько полных дней прошло с момента создания заявки. */
export function daysOpen(createdAt: string, now: number = Date.now()): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((now - created) / DAY_MS));
}

/**
 * Нужно ли предупреждать по заявке: она ещё не выполнена и висит больше недели.
 * null — предупреждать не о чем.
 */
export function staleInfo(
  lead: { status?: string; createdAt: string },
  now: number = Date.now(),
): StaleInfo | null {
  // Выполненные заявки не «висят» — их просто не успели убрать в архив.
  if (lead.status === "done") return null;
  const days = daysOpen(lead.createdAt, now);
  if (days < STALE_DAYS) return null;
  const days2 = plural(days, "день", "дня", "дней");
  return {
    days,
    level: days >= CRITICAL_DAYS ? "critical" : "warn",
    text: `висит ${days} ${days2}`,
  };
}

/** Сколько заявок висит и сколько из них — уже совсем просрочены. */
export function staleSummary(
  leads: { status?: string; createdAt: string }[],
  now: number = Date.now(),
): { count: number; critical: number } {
  let count = 0;
  let critical = 0;
  for (const lead of leads) {
    const info = staleInfo(lead, now);
    if (!info) continue;
    count += 1;
    if (info.level === "critical") critical += 1;
  }
  return { count, critical };
}

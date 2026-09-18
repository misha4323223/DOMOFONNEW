/**
 * Отбор архива: папки по городам и поиск по номеру телефона, адресу или имени.
 *
 * Чистые функции без React Native (как city.ts и repeats.ts): их удобно
 * проверять по отдельности, а экран архива остаётся только про показ.
 *
 * Папки — динамические: они не настраиваются, а собираются из самих заявок.
 * Новая заявка из Ефремова сразу попадает в папку «Ефремов»; заявки, у которых
 * город не распознан, лежат в «Без города».
 */

import { leadCity } from "./city";

/** Папка для заявок, у которых город не распознан. */
export const NO_CITY = "Без города";

/** Строка в вид для поиска: нижний регистр, «ё» → «е». */
export function fold(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

/** Только цифры — чтобы «+7 (905) …» и «8905…» сравнивались. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Ключ телефона — последние 10 цифр.
 *
 * Так «+7 (905) 629-87-08», «8 905 629 87 08» и «9056298708» — один номер,
 * и поиск находит заявку при любом способе записи.
 */
function phoneKey(value: string): string {
  const digits = digitsOnly(value);
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Город заявки в виде названия папки. */
export function cityFolderOf(lead: Parameters<typeof leadCity>[0]): string {
  return leadCity(lead) ?? NO_CITY;
}

/**
 * Совпадает ли заявка с поисковой строкой: номер телефона, адрес или имя.
 * Номер сравниваем по цифрам и не раньше третьего знака — иначе одиночная
 * «5» находила бы половину архива.
 */
export function matchesArchiveQuery(
  lead: { name: string; address: string; phone?: string | null },
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (fold(lead.name ?? "").includes(fold(q))) return true;
  if (fold(lead.address ?? "").includes(fold(q))) return true;

  const digits = digitsOnly(q);
  if (digits.length < 3) return false;
  const stored = digitsOnly(lead.phone ?? "");
  if (!stored) return false;
  return phoneKey(stored).includes(phoneKey(digits)) || stored.includes(digits);
}

/** Заявки выбранной папки, подходящие под поиск. */
export function filterArchive<T extends { name: string; address: string; phone?: string | null }>(
  leads: T[],
  city: string | null,
  query: string,
): T[] {
  return leads.filter((lead) => {
    if (city && cityFolderOf(lead) !== city) return false;
    return matchesArchiveQuery(lead, query);
  });
}

/**
 * Папки по городам с количеством заявок: сначала самые крупные, «Без города» —
 * всегда последней.
 */
export function cityFoldersOf<T extends { name: string; address: string; phone?: string | null }>(
  leads: T[],
): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const name = cityFolderOf(lead);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => {
      if (a.name === NO_CITY) return 1;
      if (b.name === NO_CITY) return -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, "ru");
    });
}

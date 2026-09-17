/**
 * Город заявки — чистые функции без React Native.
 *
 * Вынесены отдельно от maps.ts, потому что нужны и в модулях без доступа к
 * навигации (повторные обращения, группировка архива). maps.ts их
 * переиспользует и реэкспортирует, чтобы внешние импорты не менялись.
 */

/** Города, в которых служба работает постоянно. */
export const SERVICE_CITIES = ["Богородицк", "Щёкино", "Ефремов"];

/** Регион обслуживания. Подставляется, если города в заявке нет совсем. */
export const SERVICE_REGION = "Тульская область";

/** Привести строку к виду, удобному для поиска: нижний регистр, «ё» → «е». */
function forSearch(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

/**
 * Найти известный город внутри строки.
 *
 * Сравниваем по корню слова, а не целиком: «Щёкино» → «щекин» — так город
 * находится и в падежах, которыми пишут клиенты («в Щёкине, ул. …»).
 */
export function findCity(text: string): string | null {
  const haystack = forSearch(text);
  for (const city of SERVICE_CITIES) {
    const root = forSearch(city).slice(0, Math.max(4, city.length - 1));
    if (haystack.includes(root)) return city;
  }
  return null;
}

/**
 * Город заявки, если его можно понять из данных.
 *
 * У заявок, добавленных вручную, вместо имени клиента хранится город — но
 * берём его только если это действительно известный город (в старых заявках
 * там могло оказаться имя). У заявок с сайта город ищем в адресе.
 */
export function leadCity(lead: {
  name: string;
  address: string;
  source?: string;
}): string | null {
  if (lead.source === "admin") {
    return findCity(lead.name) ?? findCity(lead.address);
  }
  return findCity(lead.address);
}

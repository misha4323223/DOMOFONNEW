/**
 * Маршрут до адреса заявки — «нажал и поехал».
 *
 * Без нативных модулей: используется системная схема `geo:`, которую понимают
 * Яндекс Карты, Яндекс Навигатор, Google Maps и 2ГИС. Android сам покажет
 * установленные приложения (или откроет выбранное по умолчанию). Если карт
 * на устройстве нет — открываем Яндекс Карты в браузере, уже с маршрутом
 * от текущего местоположения.
 *
 * Отдельная боль — город. Клиенты с сайта часто пишут в адресе только улицу,
 * и тогда карты могут увести в одноимённую улицу другого города. Поэтому город
 * сначала пытаемся понять из самой заявки, а если не вышло — приложение
 * спрашивает его у админа (см. useRouteCity) и запоминает выбор.
 */
import { Linking } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Города, в которых служба работает постоянно. */
export const SERVICE_CITIES = ["Богородицк", "Щёкино", "Ефремов"];

/** Регион обслуживания. Подставляется, если города в заявке нет совсем. */
export const SERVICE_REGION = "Тульская область";

const LAST_CITY_KEY = "route_last_city";

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
 * Собрать поисковый запрос для карт.
 *
 * Если адрес уже содержит город, ничего не дублируем — Яндекс понимает
 * «в Богородицке, ул. Ленина 5».
 */
export function buildAddressQuery(address: string, city?: string): string {
  const street = address.trim();
  const place = (city ?? "").trim();
  if (!street) return place;
  if (!place || street.toLowerCase().includes(place.toLowerCase())) return street;
  return `${place}, ${street}`;
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

/** Открыть карты на этом адресе. false — ничего открыть не удалось. */
export async function openAddressInNavigator(query: string): Promise<boolean> {
  const trimmed = query.trim();
  if (!trimmed) return false;
  const encoded = encodeURIComponent(trimmed);

  // geo:0,0?q= — «точка по адресу» в приложении карт: оттуда одна кнопка
  // «Маршрут». Именно этот вариант открывает навигатор, а не браузер.
  const geoUrl = `geo:0,0?q=${encoded}`;
  // Запасной вариант — Яндекс Карты с готовым маршрутом от текущего места.
  const webUrl = `https://yandex.ru/maps/?rtext=~${encoded}&rtt=auto`;

  try {
    await Linking.openURL(geoUrl);
    return true;
  } catch {
    try {
      await Linking.openURL(webUrl);
      return true;
    } catch {
      return false;
    }
  }
}

/** Город, который выбирали в прошлый раз (показываем его первым). */
export async function getLastRouteCity(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_CITY_KEY);
  } catch {
    return null;
  }
}

/** Запомнить выбранный город. */
export async function rememberRouteCity(city: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_CITY_KEY, city);
  } catch {
    // Не сохранилось — в следующий раз просто не подскажем город
  }
}

/** Запрос для карт, когда город известен: «Богородицк, ул. Ленина 5». */
export function queryWithCity(address: string, city: string): string {
  return buildAddressQuery(address, city);
}

/** Запрос для карт, когда города нет: хотя бы ограничим регионом. */
export function queryWithoutCity(address: string): string {
  return `${address.trim()}, ${SERVICE_REGION}`;
}

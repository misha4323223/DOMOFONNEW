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
import { SERVICE_REGION } from "./city";

// Города и разбор города из заявки — в city.ts (без React Native). Здесь они
// реэкспортируются, чтобы импорты в экранах остались прежними.
export { SERVICE_CITIES, SERVICE_REGION, findCity, leadCity } from "./city";

const LAST_CITY_KEY = "route_last_city";

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

/**
 * Открыть карты по координатам.
 *
 * Точнее, чем по адресу, и без разговора о городе: клиенты с сайта часто пишут
 * только улицу, а координаты уже найдены на сервере — некуда ошибиться.
 */
export async function openPointInNavigator(
  lat: number,
  lon: number,
  label: string,
): Promise<boolean> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const point = `${lat},${lon}`;
  const name = label.trim().slice(0, 60);
  // Имя точки в скобках — так её видно на карте, а не только крестик.
  const geoUrl = `geo:${point}?q=${point}(${encodeURIComponent(name || "Заявка")})`;
  const webUrl = `https://yandex.ru/maps/?rtext=~${point}&rtt=auto`;

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

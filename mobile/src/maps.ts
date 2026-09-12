/**
 * Открыть адрес заявки в навигаторе — «нажал и поехал».
 *
 * Без нативных модулей: используется системная схема `geo:`, которую понимают
 * Яндекс Карты, Яндекс Навигатор, Google Maps и 2ГИС. Android сам покажет
 * установленные приложения (или откроет выбранное по умолчанию). Если карт
 * на устройстве нет — открываем Яндекс Карты в браузере, уже с маршрутом
 * от текущего местоположения.
 */
import { Linking } from "react-native";

/**
 * Собрать поисковый запрос для карт.
 *
 * У заявок, добавленных вручную, вместо имени клиента хранится город — тогда
 * город подставляется перед улицей («Богородицк, ул. Ленина 5»). Если адрес
 * уже содержит город, ничего не дублируем.
 */
export function buildAddressQuery(address: string, city?: string): string {
  const street = address.trim();
  const place = (city ?? "").trim();
  if (!street) return place;
  if (!place || street.toLowerCase().includes(place.toLowerCase())) return street;
  return `${place}, ${street}`;
}

/**
 * Открыть карты на этом адресе. Возвращает false, если ничего не открылось
 * (тогда вызывающий код может показать подсказку).
 */
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

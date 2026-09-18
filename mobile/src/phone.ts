/**
 * Звонок и сообщение клиенту из приложения.
 *
 * Номер приводим к виду +7XXXXXXXXXX: в заявках он записан как угодно —
 * «8 905 113 29 62», «+7 (905) 113-29-62», «89051132962».
 */
import { Linking } from "react-native";

/** Номер в вид «7XXXXXXXXXX»; пусто — звонить и писать некуда. */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length < 11 ? "" : digits;
}

export function callPhone(phone: string): void {
  const digits = normalizePhone(phone);
  // Номер короче 11 цифр — звонить некуда, ничего не делаем
  if (!digits) return;

  Linking.openURL(`tel:+${digits}`).catch(() => {
    // На устройстве нет приложения звонилки — молча пропускаем
  });
}

/**
 * SMS клиенту с готовым текстом — например, «мастер будет через 12 минут».
 *
 * Так техник предупреждает клиента одной кнопкой в поездке, не набирая текст
 * на ходу. Открываем системное приложение сообщений: отправляет его человек
 * сам, ничего не уходит помимо его воли.
 */
export function writeSms(phone: string, text: string): void {
  const digits = normalizePhone(phone);
  if (!digits) return;
  Linking.openURL(`sms:+${digits}?body=${encodeURIComponent(text)}`).catch(() => {
    // Приложение сообщений не ответило — ничего не поделать
  });
}

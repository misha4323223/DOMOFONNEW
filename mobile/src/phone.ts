/**
 * Звонок клиенту из приложения.
 *
 * Номер приводим к виду +7XXXXXXXXXX: в заявках он записан как угодно —
 * «8 905 113 29 62», «+7 (905) 113-29-62», «89051132962».
 */
import { Linking } from "react-native";

export function callPhone(phone: string): void {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  if (digits.length === 10) digits = `7${digits}`;
  // Номер короче 11 цифр — звонить некуда, ничего не делаем
  if (digits.length < 11) return;

  Linking.openURL(`tel:+${digits}`).catch(() => {
    // На устройстве нет приложения звонилки — молча пропускаем
  });
}

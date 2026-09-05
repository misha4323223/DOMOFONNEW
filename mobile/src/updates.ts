import * as Updates from "expo-updates";

/**
 * Проверка и применение OTA-обновлений (EAS Update).
 *
 * Работает только в собранном приложении (release APK): в Expo Go и
 * в режиме разработки expo-updates выключен, и все вызовы завершатся
 * ошибкой — поэтому их нужно оборачивать в try/catch.
 */

export type UpdateCheckStatus =
  | "unsupported" // expo-updates недоступен (Expo Go / dev-сборка)
  | "none" // обновлений нет
  | "available" // есть новая версия
  | "error"; // не удалось проверить (нет сети и т.п.)

/** Проверяет наличие новой версии на сервере EAS Update. */
export async function checkForUpdate(): Promise<UpdateCheckStatus> {
  try {
    if (!Updates.isEnabled) return "unsupported";
    const result = await Updates.checkForUpdateAsync();
    return result.isAvailable ? "available" : "none";
  } catch (e) {
    console.warn("Проверка обновления не удалась:", e);
    return "error";
  }
}

/**
 * Скачивает новую версию и перезапускает приложение.
 * Возвращает true, если обновление было применено.
 */
export async function downloadAndRestart(): Promise<boolean> {
  try {
    const result = await Updates.fetchUpdateAsync();
    if (!result.isNew) return false;
    await Updates.reloadAsync();
    return true;
  } catch (e) {
    console.warn("Не удалось применить обновление:", e);
    return false;
  }
}

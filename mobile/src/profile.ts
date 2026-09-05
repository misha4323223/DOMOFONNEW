/**
 * Имя пользователя (Вариант А): все админы входят под общим паролем,
 * а имя выбирается при входе и хранится на телефоне. Оно подписывается
 * под заметками и сообщениями чата.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const NAME_KEY = "user_name";

export async function getMyName(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(NAME_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function saveMyName(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(NAME_KEY, name.trim());
  } catch {
    // не критично
  }
}
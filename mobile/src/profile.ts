/**
 * Профиль пользователя (Вариант А): все админы входят под общим паролем,
 * а город и адрес выбираются при входе и хранятся на телефоне.
 * Город подписывается под заметками и сообщениями чата.
 * Адрес (улица, дом, подъезд) показывается под городом.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const PROFILE_KEY = "user_profile";

export interface UserProfile {
  city: string;
  address: string;
}

export async function getMyProfile(): Promise<UserProfile> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as UserProfile;
  } catch {
    // не критично
  }
  return { city: "", address: "" };
}

export async function saveMyProfile(profile: UserProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ city: profile.city.trim(), address: profile.address.trim() }),
    );
  } catch {
    // не критично
  }
}

/** Обратная совместимость: вернуть город как «имя». */
export async function getMyName(): Promise<string> {
  const p = await getMyProfile();
  return p.city;
}

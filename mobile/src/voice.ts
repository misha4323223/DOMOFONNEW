/**
 * Голос приложения: объявления поворотов и точек маршрута.
 *
 * Раньше приложение только слушало (в форме заявки работает диктовка), теперь
 * ещё и говорит: «Через 300 метров поверните направо», «Следующая — Ленина 5»,
 * «Вы на месте». Голос берёт на себя руль, а экран остаётся для порядка:
 * смотреть в телефон за рулём опасно.
 *
 * Синтез речи — нативный модуль (expo-speech). В APK, собранных до появления
 * голоса, его нет, поэтому require обёрнут в try/catch: старая сборка просто
 * молчит, ничего не падает.
 *
 * Тексты фраз собирают чистые функции (ниже): их можно проверить по отдельности,
 * без телефона и динамика.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

/** Синтез речи. null — в этой сборке APK его ещё нет. */
let Speech: {
  speak?: (text: string, options?: Record<string, unknown>) => void;
  stop?: () => void;
} | null = null;
try {
  Speech = require("expo-speech");
} catch {
  Speech = null;
}

/** Умеет ли эта сборка говорить. */
export const isVoiceAvailable = Boolean(Speech?.speak);

const VOICE_KEY = "ride_voice";

/** Голос включён, пока мастер сам не выключит: за рулём смотреть некогда. */
export async function loadVoiceEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(VOICE_KEY);
    return raw !== "0";
  } catch {
    return true;
  }
}

export async function saveVoiceEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(VOICE_KEY, enabled ? "1" : "0");
  } catch {
    // Не сохранилось — в следующий раз просто включим голос снова
  }
}

/**
 * Сказать фразу.
 *
 * Новую фразу начинаем сразу: подсказка про поворот, произнесённая через
 * полминуты, бесполезна. Поэтому предыдущую не договариваем.
 */
export function speak(text: string, enabled: boolean): void {
  if (!enabled || !text || !Speech?.speak) return;
  try {
    Speech.stop?.();
    Speech.speak(text, { language: "ru-RU", rate: 0.97, pitch: 1.0 });
  } catch {
    // Динамик занят или движка речи нет — молчим, поездка важнее
  }
}

/** Замолчать: при выходе из поездки ничего висеть не должно. */
export function stopSpeaking(): void {
  try {
    Speech?.stop?.();
  } catch {
    // нечего останавливать
  }
}

// Тексты подсказок вынесены в voicePhrases.ts: это чистые функции, их можно
// проверить тестом, а здесь остаётся только сам синтез речи и настройка звука.
export * from "./voicePhrases";

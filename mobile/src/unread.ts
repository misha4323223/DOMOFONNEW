import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Счётчик непрочитанных сообщений чата.
 *
 * Храним «якорь прочтения» — createdAt ПОСЛЕДНЕГО УВИДЕННОГО сообщения
 * (время ставит сервер). Счётчик = число сообщений, созданных после якоря
 * (считает App.tsx через api.chatMessages(token, anchor)).
 *
 * Важно: якорь всегда серверный (createdAt сообщения), а не время телефона —
 * иначе расхождение часов телефона и сервера навсегда «застревает» в счётчике:
 * сообщения, созданные сервером позже якоря телефона, вечно считаются новыми,
 * и бейдж не сбрасывается после прочтения.
 */
const CHAT_LAST_SEEN_KEY = "chat_last_seen";
const ANCHOR_VERSION_KEY = "chat_anchor_v";
const CURRENT_ANCHOR_VERSION = "2";

/** Кэш в памяти: чтение/запись синхронные — гонок между экранами нет. */
let memoryAnchor: string | null | undefined; // undefined — ещё не загружено

/** Якорь прочтения (серверный createdAt) или null, если чат ни разу не открывали. */
export async function getChatLastSeen(): Promise<string | null> {
  if (memoryAnchor === undefined) {
    try {
      const version = await AsyncStorage.getItem(ANCHOR_VERSION_KEY);
      if (version !== CURRENT_ANCHOR_VERSION) {
        // Старый якорь от предыдущей реализации (время телефона) —
        // сбрасываем, чтобы полл заново установил серверный якорь.
        await AsyncStorage.removeItem(CHAT_LAST_SEEN_KEY);
        await AsyncStorage.setItem(ANCHOR_VERSION_KEY, CURRENT_ANCHOR_VERSION);
        memoryAnchor = null;
      } else {
        memoryAnchor = await AsyncStorage.getItem(CHAT_LAST_SEEN_KEY);
      }
    } catch {
      memoryAnchor = null;
    }
  }
  return memoryAnchor;
}

/**
 * Обновить якорь прочтения.
 * @param anchor createdAt последнего увиденного сообщения (серверное время);
 *   null — чат пуст (якорь сбрасывается); undefined — «не знаем»,
 *   сохранённое значение не трогаем.
 */
export async function markChatRead(anchor?: string | null): Promise<void> {
  if (anchor === undefined) return;
  const value = anchor && anchor !== "" ? anchor : null;
  // Сначала в память: следующий же getChatLastSeen() увидит новое значение,
  // даже если запись в хранилище ещё идёт.
  memoryAnchor = value;
  try {
    if (value) {
      await AsyncStorage.setItem(CHAT_LAST_SEEN_KEY, value);
    } else {
      await AsyncStorage.removeItem(CHAT_LAST_SEEN_KEY);
    }
  } catch {
    // якорь не критичен — молча пропускаем
  }
}
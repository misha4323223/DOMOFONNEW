import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import {
  api,
  isNetworkError,
  isServerError,
  type ChatMessage,
} from "../api";
import {
  flushPending,
  pendingChatClientIds,
  queueChatSend,
  useSyncState,
} from "../sync";
import { getMyName, saveMyName } from "../profile";
import { colors } from "../theme";

interface Props {
  token: string;
  onBack: () => void;
}

interface PendingMessage {
  clientId: string;
  text: string;
  sender: string;
  /** Фото офлайн-сообщения (data-url). */
  image?: string;
  createdAt: string;
}

/** Элемент списка: разделитель дня или сообщение. */
type ListItem =
  | { type: "day"; label: string }
  | { type: "msg"; item: ChatMessage | PendingMessage };

/** Максимальный размер data-url фото (лимит записи YDB ~400 КБ, берём с запасом). */
const MAX_IMAGE_DATA_URL = 300_000;

/** Частота опроса новых сообщений (мс). */
const POLL_INTERVAL_MS = 5000;

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Подпись разделителя: «Сегодня», «Вчера» или дата. */
function dayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return "Сегодня";
    if (sameDay(d, yesterday)) return "Вчера";
    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/** Инициалы отправителя для аватара. */
function getInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "?";
}

/** Приглушённая палитра аватаров — подходит к тёмной теме. */
const AVATAR_COLORS = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
];

/** Стабильный цвет аватара по имени. */
function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * Сжать фото и вернуть data-url jpeg. Сначала пробуем крупный вариант,
 * при превышении лимита — сильнее сжимаем.
 */
async function compressToDataUrl(uri: string): Promise<string | null> {
  const attempt = async (width: number, compress: number) => {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress, format: ImageManipulator.SaveFormat.JPEG },
    );
    const base64 = await FileSystem.readAsStringAsync(result.uri, {
      encoding: "base64",
    });
    return `data:image/jpeg;base64,${base64}`;
  };

  let dataUrl = await attempt(1280, 0.7);
  if (dataUrl.length > MAX_IMAGE_DATA_URL) {
    dataUrl = await attempt(800, 0.5);
  }
  if (dataUrl.length > MAX_IMAGE_DATA_URL) {
    Alert.alert(
      "Фото слишком большое",
      "Прикрепите изображение поменьше (до ~200 КБ).",
    );
    return null;
  }
  return dataUrl;
}

export function ChatScreen({ token, onBack }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [input, setInput] = useState("");
  /** Фото, выбранное для отправки (data-url). */
  const [pickedImage, setPickedImage] = useState<string | null>(null);
  /** Фото в полноэкранном просмотре (data-url). */
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [myName, setMyName] = useState("Админ");
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [sending, setSending] = useState(false);
  /** ID сообщения, которое сейчас редактируется. null — обычный ввод. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const listRef = useRef<FlatList<ListItem>>(null);
  const lastCreatedRef = useRef<string | undefined>(undefined);
  const { revision } = useSyncState();

  useEffect(() => {
    (async () => {
      const name = await getMyName();
      if (name) setMyName(name);
    })();
  }, []);

  /** Обновить список сообщений (полная перезагрузка). */
  const loadAll = useCallback(async () => {
    try {
      const data = await api.chatMessages(token);
      setMessages(data ?? []);
      lastCreatedRef.current = data?.[data.length - 1]?.createdAt;
      setIsOffline(false);
      await flushPending(token);
    } catch (e) {
      setIsOffline(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  /** Догрузить только новые сообщения (после последнего). */
  const poll = useCallback(async () => {
    try {
      const data = await api.chatMessages(token, lastCreatedRef.current);
      if (data && data.length > 0) {
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const fresh = data.filter((m) => !known.has(m.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
        lastCreatedRef.current = data[data.length - 1].createdAt;
      }
      setIsOffline(false);
      // Подтягиваем актуальный список «ожидающих» — отправленные уходят из него
      const queued = await pendingChatClientIds();
      setPending((prev) => prev.filter((p) => queued.includes(p.clientId)));
    } catch {
      setIsOffline(true);
    }
  }, [token]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadAll, poll]);

  // После успешной отправки очереди — полная перезагрузка, чтобы
  // отправленные офлайн сообщения появились с настоящими id.
  useEffect(() => {
    if (revision > 0) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  /** Выбрать фото из галереи и подготовить к отправке. */
  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });
      if (result.canceled || result.assets.length === 0) return;
      const dataUrl = await compressToDataUrl(result.assets[0].uri);
      if (dataUrl) setPickedImage(dataUrl);
    } catch (e) {
      Alert.alert(
        "Ошибка",
        e instanceof Error ? e.message : "Не удалось открыть галерею",
      );
    }
  };

  /** Отправить новое сообщение или обновить редактируемое. */
  const send = async () => {
    const text = input.trim();
    if (sending || (!text && !pickedImage)) return;

    // --- Режим редактирования (меняем только текст) ---
    if (editingId) {
      const msgId = editingId;
      setEditingId(null);
      setInput("");
      setSending(true);
      try {
        const updated = await api.updateChatMessage(token, msgId, text);
        if (updated) {
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? updated : m)),
          );
        }
      } catch (e) {
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось отредактировать",
        );
        setInput(text);
        setEditingId(msgId);
      } finally {
        setSending(false);
      }
      return;
    }

    // --- Обычная отправка (текст и/или фото) ---
    const image = pickedImage;
    setInput("");
    setPickedImage(null);
    setSending(true);
    try {
      const created = await api.sendChatMessage(token, text, myName, image ?? undefined);
      setMessages((prev) => [...prev, created]);
      lastCreatedRef.current = created.createdAt;
      setIsOffline(false);
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — сообщение уходит в очередь и отправится само
        const clientId = genId();
        const pendingMsg: PendingMessage = {
          clientId,
          text,
          sender: myName,
          ...(image ? { image } : {}),
          createdAt: new Date().toISOString(),
        };
        setPending((prev) => [...prev, pendingMsg]);
        await queueChatSend(clientId, text, myName, image ?? undefined);
        setIsOffline(true);
      } else {
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось отправить сообщение",
        );
        setInput(text);
        if (image) setPickedImage(image);
      }
    } finally {
      setSending(false);
    }
  };

  /** Долгое нажатие на своё сообщение — меню редактирования / удаления. */
  const onLongPress = (entry: ChatMessage | PendingMessage) => {
    if ("clientId" in entry) return; // офлайн-сообщения нельзя
    const msg = entry as ChatMessage;
    if (msg.sender !== myName) return; // только мои сообщения

    const label = msg.text ? msg.text : msg.image ? "Фото" : "Сообщение";
    Alert.alert(label, undefined, [
      {
        text: "Редактировать",
        onPress: () => {
          setEditingId(msg.id);
          setInput(msg.text);
        },
      },
      {
        text: "Удалить",
        style: "destructive",
        onPress: () => {
          Alert.alert("Удалить сообщение?", "Это действие нельзя отменить", [
            { text: "Отмена", style: "cancel" },
            {
              text: "Удалить",
              style: "destructive",
              onPress: async () => {
                try {
                  await api.deleteChatMessage(token, msg.id);
                  setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                } catch (e) {
                  Alert.alert(
                    "Ошибка",
                    e instanceof Error
                      ? e.message
                      : "Не удалось удалить сообщение",
                  );
                }
              },
            },
          ]);
        },
      },
      { text: "Отмена", style: "cancel" },
    ]);
  };

  /** Отмена редактирования. */
  const cancelEdit = () => {
    setEditingId(null);
    setInput("");
  };

  // Склеиваем серверные сообщения и «ожидающие» (офлайн) в один список
  // с разделителями дней. Показываем до 200 последних.
  const combined: ListItem[] = [];
  {
    let lastDay = "";
    const items: (ChatMessage | PendingMessage)[] = [
      ...messages,
      ...pending.map((p) => ({ ...p, id: `local-${p.clientId}` })),
    ].slice(-200);
    for (const item of items) {
      const day = dayLabel(item.createdAt);
      if (day !== lastDay) {
        combined.push({ type: "day", label: day });
        lastDay = day;
      }
      combined.push({ type: "msg", item });
    }
  }

  const scrollToEnd = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const renderBubble = (entry: ChatMessage | PendingMessage) => {
    const isOwn = entry.sender === myName;
    const isPending = "clientId" in entry;
    const msg = entry as ChatMessage;
    return (
      <View style={[styles.row, isOwn ? styles.rowOwn : styles.rowOther]}>
        {!isOwn && (
          <View style={[styles.avatar, { backgroundColor: colorForName(entry.sender) }]}>
            <Text style={styles.avatarText}>{getInitials(entry.sender)}</Text>
          </View>
        )}
        <Pressable
          onLongPress={isOwn ? () => onLongPress(entry) : undefined}
          delayLongPress={400}
          style={[
            styles.bubbleWrap,
            isOwn ? styles.bubbleWrapOwn : styles.bubbleWrapOther,
          ]}
        >
          <View
            style={[
              styles.bubble,
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
              isPending && styles.bubblePending,
            ]}
          >
            {!isOwn && <Text style={styles.senderName}>{entry.sender}</Text>}
            {msg.image ? (
              <Pressable onPress={() => setViewerUri(msg.image ?? null)}>
                <Image source={{ uri: msg.image }} style={styles.bubbleImage} />
              </Pressable>
            ) : null}
            {!!entry.text && (
              <Text
                // 0 = без ограничения строк: текст никогда не обрезается
                numberOfLines={0}
                style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}
              >
                {entry.text}
              </Text>
            )}
            <View style={styles.timeRow}>
              <Text style={[styles.bubbleTime, isOwn && styles.bubbleTimeOwn]}>
                {isPending ? "⏳ " : ""}
                {formatTime(entry.createdAt)}
                {msg.editedAt ? " · ред." : ""}
              </Text>
            </View>
          </View>
        </Pressable>
      </View>
    );
  };

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === "day") {
      return (
        <View style={styles.dayDivider}>
          <View style={styles.dayLine} />
          <Text style={styles.dayText}>{item.label}</Text>
          <View style={styles.dayLine} />
        </View>
      );
    }
    return renderBubble(item.item);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Назад</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Чат</Text>
          <Text style={styles.headerSubtitle}>
            {isOffline ? "Нет связи" : `Вы — ${myName}`}
          </Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            📡 Нет связи — сообщения отправятся, когда появится интернет
          </Text>
        </View>
      )}

      {editingId && (
        <View style={styles.editBanner}>
          <Text style={styles.editBannerText}>✏️ Редактирование сообщения</Text>
          <Pressable onPress={cancelEdit} hitSlop={8}>
            <Text style={styles.editCancel}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* Полноэкранный просмотр фото */}
      <Modal
        visible={viewerUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
      >
        <Pressable style={styles.viewer} onPress={() => setViewerUri(null)}>
          {viewerUri ? (
            <Image
              source={{ uri: viewerUri }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : null}
          <Text style={styles.viewerClose}>✕ Закрыть</Text>
        </Pressable>
      </Modal>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={combined}
            keyExtractor={(item) =>
              item.type === "day"
                ? `day-${item.label}`
                : "clientId" in item.item
                  ? `local-${item.item.clientId}`
                  : item.item.id
            }
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onContentSizeChange={scrollToEnd}
            onLayout={scrollToEnd}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.emptyTitle}>💬 Сообщений пока нет</Text>
                <Text style={styles.empty}>Напишите первым!</Text>
              </View>
            }
          />
        )}

        {/* Превью выбранного фото */}
        {pickedImage && (
          <View style={styles.previewRow}>
            <Image source={{ uri: pickedImage }} style={styles.previewImage} />
            <Text style={styles.previewHint}>Фото готово к отправке</Text>
            <Pressable onPress={() => setPickedImage(null)} hitSlop={10}>
              <Text style={styles.previewClose}>✕</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.inputRow}>
          {!editingId && (
            <Pressable
              style={({ pressed }) => [
                styles.attachButton,
                pressed && { opacity: 0.7 },
              ]}
              onPress={pickImage}
              hitSlop={8}
            >
              <Text style={styles.attachText}>📎</Text>
            </Pressable>
          )}
          <TextInput
            style={styles.input}
            placeholder={editingId ? "Редактировать…" : "Сообщение…"}
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            returnKeyType="send"
            multiline
            maxLength={2000}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendButton,
              (!input.trim() && !pickedImage) && styles.sendButtonDisabled,
              pressed && { opacity: 0.85 },
            ]}
            onPress={send}
            disabled={sending || (!input.trim() && !pickedImage)}
          >
            <Text style={styles.sendButtonText}>
              {editingId ? "✓" : "➤"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 12,
  },
  backText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  headerCenter: {
    // flex: 1 — центральная часть получает доступную ширину, иначе текст
    // подзаголовка («Вы — имя») не переносится и обрезается в „…“ (баг Fabric)
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
  },
  headerSpacer: {
    width: 70,
  },
  offlineBanner: {
    backgroundColor: "rgba(245,158,11,0.15)",
    borderBottomWidth: 1,
    borderBottomColor: "#f59e0b",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineText: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  editBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(59,130,246,0.15)",
    borderBottomWidth: 1,
    borderBottomColor: "#3b82f6",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  editBannerText: {
    color: "#60a5fa",
    fontSize: 13,
    fontWeight: "600",
  },
  editCancel: {
    color: "#60a5fa",
    fontSize: 18,
    fontWeight: "700",
    paddingLeft: 12,
  },
  list: {
    padding: 16,
    paddingBottom: 24,
    gap: 8,
    flexGrow: 1,
  },
  dayDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 10,
  },
  dayLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  dayText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  rowOwn: {
    justifyContent: "flex-end",
  },
  rowOther: {
    justifyContent: "flex-start",
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  avatarText: {
    color: "#0a0a0a",
    fontSize: 11,
    fontWeight: "800",
  },
  // ВАЖНО: пузырю задана ЯВНАЯ ширина (обёртка — ровно 78% экрана, пузырь —
  // 100% обёртки). В новой архитектуре RN (Fabric) пузырь, меряющийся по
  // контенту, не даёт Text'у доступную ширину для переноса — и текст
  // сжимается до нескольких букв и обрезается многоточием. С явной шириной
  // текст гарантированно получает ширину и переносится целиком.
  bubbleWrap: {
    width: "78%",
  },
  bubbleWrapOwn: {
    alignItems: "flex-end",
  },
  bubbleWrapOther: {
    alignItems: "flex-start",
  },
  bubble: {
    width: "100%",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 3,
  },
  bubbleOwn: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderBottomLeftRadius: 4,
  },
  bubblePending: {
    opacity: 0.6,
    borderStyle: "dashed",
  },
  senderName: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  bubbleImage: {
    width: 230,
    height: 190,
    maxWidth: "100%",
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    marginTop: 2,
  },
  bubbleText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  bubbleTextOwn: {
    color: colors.primaryForeground,
  },
  timeRow: {
    alignItems: "flex-end",
    marginTop: 2,
  },
  bubbleTime: {
    color: colors.textMuted,
    fontSize: 10,
  },
  bubbleTimeOwn: {
    color: "rgba(26,20,5,0.65)",
  },
  viewer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 16,
  },
  viewerImage: {
    width: "100%",
    height: "82%",
  },
  viewerClose: {
    color: "#a3a3a3",
    fontSize: 14,
    fontWeight: "600",
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: colors.card,
  },
  previewImage: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
  },
  previewHint: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
  },
  previewClose: {
    color: colors.destructive,
    fontSize: 18,
    fontWeight: "700",
    padding: 4,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  attachButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
  },
  attachText: {
    fontSize: 17,
  },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 110,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 21,
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: colors.primaryForeground,
    fontSize: 17,
    fontWeight: "800",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 6,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  empty: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
  },
});
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { getMyProfile, type UserProfile } from "../profile";
import { colors } from "../theme";

interface Props {
  token: string;
  onBack: () => void;
}

interface PendingMessage {
  clientId: string;
  text: string;
  sender: string;
}

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

/** Частота опроса новых сообщений (секунды). */
const POLL_INTERVAL_MS = 5000;

export function ChatScreen({ token, onBack }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<UserProfile>({ city: "Админ", address: "" });
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [sending, setSending] = useState(false);
  /** ID сообщения, которое сейчас редактируется. null — обычный ввод. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const listRef = useRef<FlatList<ChatMessage | PendingMessage>>(null);
  const lastCreatedRef = useRef<string | undefined>(undefined);
  const { revision } = useSyncState();

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      if (p.city) setProfile(p);
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

  /** Отправить новое сообщение или обновить редактируемое. */
  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    // --- Режим редактирования ---
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

    // --- Обычная отправка ---
    setInput("");
    setSending(true);
    try {
      const created = await api.sendChatMessage(token, text, profile.city, profile.address);
      setMessages((prev) => [...prev, created]);
      lastCreatedRef.current = created.createdAt;
      setIsOffline(false);
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — сообщение уходит в очередь и отправится само
        const clientId = genId();
        setPending((prev) => [...prev, { clientId, text, sender: profile.city }]);
        await queueChatSend(clientId, text, profile.city, profile.address);
        setIsOffline(true);
      } else {
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось отправить сообщение",
        );
        setInput(text);
      }
    } finally {
      setSending(false);
    }
  };

  /** Долгое нажатие на своё сообщение — меню редактирования / удаления. */
  const onLongPress = (item: ChatMessage | PendingMessage) => {
    if ("clientId" in item) return; // офлайн-сообщения нельзя
    const msg = item as ChatMessage;
    if (msg.sender !== profile.city) return; // чужие тоже

    Alert.alert("Сообщение", msg.text, [
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

  // Склеиваем серверные сообщения и «ожидающие» (офлайн) в один список.
  // Показываем до 200 последних, чтобы не грузить телефон.
  const combined: (ChatMessage | PendingMessage)[] = [
    ...messages,
    ...pending.map((p) => ({ ...p, id: `local-${p.clientId}` })),
  ].slice(-200);

  const scrollToEnd = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const renderItem = ({ item }: { item: ChatMessage | PendingMessage }) => {
    const isOwn = item.sender === profile.city;
    const isPending = "clientId" in item;
    const isEdited =
      !isPending && "editedAt" in item && (item as ChatMessage).editedAt;
    return (
      <Pressable
        onLongPress={() => onLongPress(item)}
        delayLongPress={400}
        style={[
          styles.bubbleWrap,
          isOwn ? styles.bubbleWrapOwn : styles.bubbleWrapOther,
        ]}
      >
        {!isOwn ? (
          <>
            <Text style={styles.bubbleSender}>{item.sender}</Text>
            {"address" in item && (item as ChatMessage).address ? (
              <Text style={styles.bubbleAddress}>{(item as ChatMessage).address}</Text>
            ) : null}
          </>
        ) : null}
        <View
          style={[
            styles.bubble,
            isOwn ? styles.bubbleOwn : styles.bubbleOther,
            isPending && styles.bubblePending,
          ]}
        >
          <Text style={[styles.bubbleText, isOwn && styles.bubbleTextOwn]}>
            {item.text}
            {isPending ? " ⏳" : ""}
          </Text>
        </View>
        <Text style={styles.bubbleTime}>
          {isOwn ? `Вы · ` : ""}
          {"createdAt" in item && item.createdAt ? formatTime(item.createdAt) : ""}
          {isEdited ? " (ред.)" : ""}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Назад</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Чат</Text>
          <Text style={styles.headerSubtitle}>Вы — {profile.city}{profile.address ? `, ${profile.address}` : ""}</Text>
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
              "clientId" in item ? `local-${item.clientId}` : item.id
            }
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onContentSizeChange={scrollToEnd}
            onLayout={scrollToEnd}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.empty}>
                  Сообщений пока нет. Напишите первым!
                </Text>
              </View>
            }
          />
        )}

        <View style={styles.inputRow}>
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
              pressed && { opacity: 0.85 },
            ]}
            onPress={send}
            disabled={sending || !input.trim()}
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
    gap: 10,
    flexGrow: 1,
  },
  bubbleWrap: {
    maxWidth: "82%",
    gap: 2,
  },
  bubbleWrapOwn: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  bubbleWrapOther: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  bubbleSender: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 4,
  },
  bubbleAddress: {
    color: colors.textMuted,
    fontSize: 10,
    marginLeft: 4,
    opacity: 0.7,
  },
  bubble: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  bubbleText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  bubbleTextOwn: {
    color: colors.primaryForeground,
  },
  bubbleTime: {
    color: colors.textMuted,
    fontSize: 10,
    marginHorizontal: 4,
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
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 110,
  },
  sendButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonText: {
    color: colors.primaryForeground,
    fontSize: 18,
    fontWeight: "800",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  empty: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: "center",
  },
});

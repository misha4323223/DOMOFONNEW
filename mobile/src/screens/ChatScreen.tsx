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
import { getMyName } from "../profile";
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
  const [myName, setMyName] = useState("Админ");
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList<ChatMessage | PendingMessage>>(null);
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

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      const created = await api.sendChatMessage(token, text, myName);
      setMessages((prev) => [...prev, created]);
      lastCreatedRef.current = created.createdAt;
      setIsOffline(false);
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — сообщение уходит в очередь и отправится само
        const clientId = genId();
        setPending((prev) => [...prev, { clientId, text, sender: myName }]);
        await queueChatSend(clientId, text, myName);
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
    const isOwn = item.sender === myName;
    const isPending = "clientId" in item;
    return (
      <View
        style={[
          styles.bubbleWrap,
          isOwn ? styles.bubbleWrapOwn : styles.bubbleWrapOther,
        ]}
      >
        {!isOwn ? <Text style={styles.bubbleSender}>{item.sender}</Text> : null}
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
        </Text>
      </View>
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
          <Text style={styles.headerSubtitle}>Вы — {myName}</Text>
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
            placeholder="Сообщение…"
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
            <Text style={styles.sendButtonText}>➤</Text>
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
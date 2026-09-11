import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  api,
  reviewStatusLabel,
  type Review,
  type ReviewStatus,
} from "../api";
import { EmptyState } from "../components/EmptyState";
import { ListSkeleton } from "../components/Skeletons";
import { colors } from "../theme";

interface Props {
  token: string;
  onBack: () => void;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function Stars({ rating }: { rating: number }) {
  return (
    <Text style={styles.stars}>
      {"★".repeat(Math.max(0, Math.min(5, rating)))}
      <Text style={styles.starsEmpty}>
        {"★".repeat(Math.max(0, 5 - Math.min(5, rating)))}
      </Text>
    </Text>
  );
}

export function ReviewsScreen({ token, onBack }: Props) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Развёрнутые отзывы: по умолчанию текст показываем компактно (3 строки)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Ответ службы на отзыв
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [savingReply, setSavingReply] = useState(false);

  const load = useCallback(
    async (asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      try {
        const data = await api.reviews(token);
        setReviews(data ?? []);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить отзывы");
      } finally {
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load();
    // Автообновление, чтобы новые отзывы с сайта появлялись сами
    const interval = setInterval(() => load(), 20000);
    return () => clearInterval(interval);
  }, [load]);

  const setStatus = async (review: Review, status: ReviewStatus) => {
    if (busyId) return;
    const prev = review.status;
    // Оптимистично меняем сразу
    setReviews((list) =>
      list ? list.map((r) => (r.id === review.id ? { ...r, status } : r)) : list,
    );
    setBusyId(review.id);
    try {
      await api.updateReview(token, review.id, { status });
      setError(null);
    } catch (e) {
      // Не получилось — откатываем и показываем ошибку
      setReviews((list) =>
        list ? list.map((r) => (r.id === review.id ? { ...r, status: prev } : r)) : list,
      );
      Alert.alert(
        "Ошибка",
        e instanceof Error ? e.message : "Не удалось обновить отзыв",
      );
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (review: Review) => {
    Alert.alert(
      "Удалить отзыв?",
      `${review.name} — ${reviewStatusLabel(review.status)}`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteReview(token, review.id);
              setReviews((list) =>
                list ? list.filter((r) => r.id !== review.id) : list,
              );
            } catch (e) {
              Alert.alert(
                "Ошибка",
                e instanceof Error ? e.message : "Не удалось удалить отзыв",
              );
            }
          },
        },
      ],
    );
  };

  const openReply = (review: Review) => {
    setReplyFor(review.id);
    setReplyDraft(review.reply ?? "");
  };

  /** Сохранить ответ службы (пустая строка — убрать ответ). */
  const saveReply = async (review: Review, value: string) => {
    if (savingReply) return;
    const reply = value.trim();
    setSavingReply(true);
    // Оптимистично показываем ответ сразу, при ошибке вернём данные с сервера
    setReviews((list) =>
      list ? list.map((r) => (r.id === review.id ? { ...r, reply } : r)) : list,
    );
    try {
      await api.updateReview(token, review.id, { reply });
      setReplyFor(null);
      setReplyDraft("");
      setError(null);
    } catch (e) {
      Alert.alert(
        "Ошибка",
        e instanceof Error ? e.message : "Не удалось сохранить ответ",
      );
      await load();
    } finally {
      setSavingReply(false);
    }
  };

  const statusBadgeStyle = (status: ReviewStatus) => {
    if (status === "published") return styles.statusPublished;
    if (status === "new") return styles.statusNew;
    return styles.statusHidden;
  };

  const pending = reviews?.filter((r) => r.status === "new").length ?? 0;

  const renderCard = ({ item }: { item: Review }) => {
    const hasReply = Boolean(item.reply?.trim());
    const replyOpen = replyFor === item.id;
    const isExpanded = Boolean(expanded[item.id]);

    return (
      <View style={styles.card}>
        {/* Верх: имя, звёзды, статус — одной строкой */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardName}>{item.name}</Text>
          <Stars rating={Number(item.rating) || 0} />
          <View style={[styles.statusBadge, statusBadgeStyle(item.status)]}>
            <Text style={styles.statusBadgeText}>
              {reviewStatusLabel(item.status)}
            </Text>
          </View>
        </View>

        {/* Дата и город — мелкой строкой */}
        <Text style={styles.cardMeta}>
          {formatDate(item.createdAt)}
          {item.city ? `  ·  📍 ${item.city}` : ""}
        </Text>

        {/* Текст отзыва: по умолчанию 3 строки — карточка компактная */}
        <Text style={styles.cardText} numberOfLines={isExpanded ? undefined : 3}>
          {item.text}
        </Text>
        {item.text.length > 140 ? (
          <Pressable
            onPress={() =>
              setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
            }
            hitSlop={8}
          >
            <Text style={styles.moreText}>
              {isExpanded ? "Свернуть" : "Читать полностью"}
            </Text>
          </Pressable>
        ) : null}

        {/* Уже сохранённый ответ службы */}
        {hasReply && !replyOpen ? (
          <View style={styles.replyBox}>
            <Text style={styles.replyTitle}>Ответ службы</Text>
            <Text style={styles.replyText}>{item.reply}</Text>
          </View>
        ) : null}

        {/* Форма ответа */}
        {replyOpen ? (
          <View style={styles.replyForm}>
            <TextInput
              style={styles.replyInput}
              value={replyDraft}
              onChangeText={setReplyDraft}
              placeholder="Ответ клиенту — появится под отзывом на сайте"
              placeholderTextColor={colors.textMuted}
              multiline
              autoFocus
              maxLength={1000}
            />
            <View style={styles.cardActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionPublish,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => saveReply(item, replyDraft)}
                disabled={savingReply}
                hitSlop={6}
              >
                <Text style={styles.actionPublishText}>
                  {savingReply ? "Сохраняем…" : "Сохранить ответ"}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => {
                  setReplyFor(null);
                  setReplyDraft("");
                }}
                hitSlop={6}
              >
                <Text style={styles.actionText}>Отмена</Text>
              </Pressable>
              {hasReply ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.actionDelete,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => saveReply(item, "")}
                  disabled={savingReply}
                  hitSlop={6}
                >
                  <Text style={styles.actionDeleteText}>Убрать ответ</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Действия */}
        {busyId === item.id ? (
          <ActivityIndicator
            size="small"
            color={colors.primary}
            style={styles.cardBusy}
          />
        ) : (
          <View style={styles.cardActions}>
            {item.status !== "published" && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.actionPublish,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setStatus(item, "published")}
                hitSlop={6}
              >
                <Text style={styles.actionPublishText}>Опубликовать</Text>
              </Pressable>
            )}
            {item.status !== "hidden" && (
              <Pressable
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setStatus(item, "hidden")}
                hitSlop={6}
              >
                <Text style={styles.actionText}>Скрыть</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => openReply(item)}
              hitSlop={6}
            >
              <Text style={styles.actionText}>
                {hasReply ? "Изменить ответ" : "Ответить"}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionDelete,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => confirmDelete(item)}
              hitSlop={6}
            >
              <Text style={styles.actionDeleteText}>Удалить</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
            <Text style={styles.backText}>← Назад</Text>
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Отзывы</Text>
            <Text style={styles.headerCount}>
              {reviews ? `${reviews.length} всего` : " "}
              {pending > 0 ? ` · ${pending} ждут проверки` : ""}
            </Text>
          </View>
        </View>
        {pending > 0 && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingText}>
              ⭐ {pending} {pending === 1 ? "отзыв ждёт" : "отзывов ждут"} проверки
            </Text>
          </View>
        )}
      </View>

      {reviews === null && !error ? (
        <ListSkeleton />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => load()}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={reviews ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState                iconName="star-outline"
              title="Отзывов пока нет"
              hint="Клиенты оставляют их прямо на сайте — в блоке «Отзывы»"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.inputBg,
  },
  backText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  headerCount: {
    color: colors.textMuted,
    fontSize: 13,
  },
  pendingBanner: {
    backgroundColor: "rgba(245,158,11,0.15)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#f59e0b",
  },
  pendingText: {
    color: "#fbbf24",
    fontSize: 12.5,
    fontWeight: "700",
  },
  list: {
    padding: 12,
    gap: 10,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    gap: 6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  statusNew: {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245,158,11,0.18)",
  },
  statusPublished: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.18)",
  },
  statusHidden: {
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
  },
  statusBadgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
  },
  stars: {
    color: "#fbbf24",
    fontSize: 13,
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  starsEmpty: {
    color: colors.textMuted,
    opacity: 0.35,
  },
  cardMeta: {
    color: colors.textMuted,
    fontSize: 11,
  },
  cardText: {
    color: colors.text,
    fontSize: 13.5,
    lineHeight: 19,
  },
  moreText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  replyBox: {
    marginTop: 4,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary,
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    gap: 2,
  },
  replyTitle: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  replyText: {
    color: colors.text,
    fontSize: 12.5,
    lineHeight: 17,
  },
  replyForm: {
    marginTop: 4,
    gap: 8,
  },
  replyInput: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 13.5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 64,
    textAlignVertical: "top",
  },
  cardBusy: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: colors.inputBg,
  },
  actionPublish: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.15)",
  },
  actionPublishText: {
    color: "#4ade80",
    fontSize: 12,
    fontWeight: "700",
  },
  actionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  actionDelete: {
    borderColor: colors.destructive,
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  actionDeleteText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "700",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  error: {
    color: colors.destructive,
    fontSize: 15,
    textAlign: "center",
  },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryText: {
    color: colors.primary,
    fontWeight: "600",
  },
  empty: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
  },
  emptyHint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    opacity: 0.8,
  },
});
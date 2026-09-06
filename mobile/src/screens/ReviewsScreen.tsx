import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  api,
  reviewStatusLabel,
  type Review,
  type ReviewStatus,
} from "../api";
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
      await api.updateReview(token, review.id, status);
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

  const statusBadgeStyle = (status: ReviewStatus) => {
    if (status === "published") return styles.statusPublished;
    if (status === "new") return styles.statusNew;
    return styles.statusHidden;
  };

  const pending = reviews?.filter((r) => r.status === "new").length ?? 0;

  const renderCard = ({ item }: { item: Review }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{item.name}</Text>
        <View style={[styles.statusBadge, statusBadgeStyle(item.status)]}>
          <Text style={styles.statusBadgeText}>
            {reviewStatusLabel(item.status)}
          </Text>
        </View>
      </View>
      <Stars rating={Number(item.rating) || 0} />
      {item.city ? (
        <Text style={styles.cardCity}>📍 {item.city}</Text>
      ) : null}
      <Text style={styles.cardText}>{item.text}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
        <View style={styles.cardActions}>
          {busyId === item.id ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
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
                  styles.actionDelete,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => confirmDelete(item)}
                hitSlop={6}
              >
                <Text style={styles.actionDeleteText}>Удалить</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );

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
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
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
            <View style={styles.center}>
              <Text style={styles.empty}>Отзывов пока нет</Text>
              <Text style={styles.emptyHint}>
                Клиенты оставляют их прямо на сайте — в блоке «Отзывы»
              </Text>
            </View>
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
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#f59e0b",
  },
  pendingText: {
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "700",
  },
  list: {
    padding: 16,
    gap: 12,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardName: {
    color: colors.text,
    fontSize: 17,
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
    fontSize: 16,
    letterSpacing: 1,
  },
  starsEmpty: {
    color: colors.textMuted,
    opacity: 0.35,
  },
  cardCity: {
    color: colors.textMuted,
    fontSize: 13,
  },
  cardText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  cardFooter: {
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 10,
    gap: 8,
  },
  cardDate: {
    color: colors.textMuted,
    fontSize: 12,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
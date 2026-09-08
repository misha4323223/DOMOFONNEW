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
  isNetworkError,
  isServerError,
  serviceLabel,
  type Lead,
} from "../api";
import { queueLeadDelete, queueLeadUpdate } from "../sync";
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

/**
 * Архив выполненных заявок: сюда попадают заявки со статусом «Выполнена»,
 * которые админ отправил в архив с главного экрана. Их можно вернуть
 * обратно в активный список или удалить навсегда.
 */
export function ArchiveScreen({ token, onBack }: Props) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      try {
        const data = (await api.leads(token)) as Lead[];
        // Показываем только заявки из архива
        setLeads((data ?? []).filter((l) => l.archived === "1"));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить архив");
      } finally {
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load();
    // Автообновление, чтобы список не расходился с главным экраном
    const interval = setInterval(() => load(), 20000);
    return () => clearInterval(interval);
  }, [load]);

  /** Вернуть заявку из архива в активный список (статус «Выполнена» сохраняется). */
  const restore = async (lead: Lead) => {
    if (busyId) return;
    // Оптимистично убираем из списка
    setLeads((list) => (list ? list.filter((l) => l.id !== lead.id) : list));
    setBusyId(lead.id);
    try {
      await api.updateLead(token, lead.id, { archived: "0" });
      setError(null);
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — вернётся само, когда появится интернет
        await queueLeadUpdate(lead.id, { archived: "0" });
      } else {
        setLeads((list) => (list ? [...list, lead] : list));
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось вернуть заявку",
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = (lead: Lead) => {
    Alert.alert(
      "Удалить заявку?",
      `${lead.name} — ${serviceLabel(lead.service)}`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await api.deleteLead(token, lead.id);
              setLeads((list) => (list ? list.filter((l) => l.id !== lead.id) : list));
            } catch (e) {
              if (isNetworkError(e) || isServerError(e)) {
                // Нет связи — удаление применится, когда появится интернет
                await queueLeadDelete(lead.id);
                setLeads((list) => (list ? list.filter((l) => l.id !== lead.id) : list));
              } else {
                Alert.alert(
                  "Ошибка",
                  e instanceof Error ? e.message : "Не удалось удалить заявку",
                );
              }
            }
          },
        },
      ],
    );
  };

  const renderCard = ({ item }: { item: Lead }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{item.name}</Text>
        <View style={styles.doneBadge}>
          <Text style={styles.doneBadgeText}>✓ Выполнена</Text>
        </View>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>📞 </Text>
        {item.phone ? (
          <Text style={styles.cardPhone}>{item.phone}</Text>
        ) : (
          <Text style={styles.cardPhoneMissing}>Без телефона</Text>
        )}
      </View>
      <View style={styles.chipRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{serviceLabel(item.service)}</Text>
        </View>
        <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
      </View>
      <Text style={styles.cardAddress}>📍 {item.address}</Text>
      {item.comment ? (
        <Text style={styles.cardComment}>💬 {item.comment}</Text>
      ) : null}
      <View style={styles.cardFooter}>
        {busyId === item.id ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <View style={styles.cardActions}>
            <Pressable
              style={({ pressed }) => [
                styles.actionButton,
                styles.actionRestore,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => restore(item)}
              hitSlop={6}
            >
              <Text style={styles.actionRestoreText}>↩ Вернуть</Text>
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
            <Text style={styles.headerTitle}>Архив</Text>
            <Text style={styles.headerCount}>
              {leads ? `${leads.length} ${leads.length === 1 ? "заявка" : "заявок"}` : " "}
            </Text>
          </View>
        </View>
      </View>

      {leads === null && !error ? (
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
          data={leads ?? []}
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
              <Text style={styles.empty}>Архив пуст</Text>
              <Text style={styles.emptyHint}>
                Выполненные заявки отправляются сюда с главного экрана
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
    gap: 6,
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
  doneBadge: {
    backgroundColor: "rgba(34,197,94,0.15)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  doneBadgeText: {
    color: "#4ade80",
    fontSize: 11,
    fontWeight: "700",
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardLabel: {
    fontSize: 14,
  },
  cardPhone: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  cardPhoneMissing: {
    color: colors.destructive,
    fontSize: 15,
    fontWeight: "700",
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  cardDate: {
    color: colors.textMuted,
    fontSize: 12,
  },
  cardAddress: {
    color: colors.text,
    fontSize: 14,
  },
  cardComment: {
    color: colors.textMuted,
    fontSize: 13,
  },
  cardFooter: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 10,
    minHeight: 34,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.inputBg,
  },
  actionRestore: {
    borderColor: colors.primary,
    backgroundColor: "rgba(245,162,11,0.15)",
  },
  actionRestoreText: {
    color: "#f5a20b",
    fontSize: 13,
    fontWeight: "700",
  },
  actionDelete: {
    borderColor: colors.destructive,
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  actionDeleteText: {
    color: "#f87171",
    fontSize: 13,
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
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
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import {
  api,
  serviceLabel,
  LEAD_STATUSES,
  type Lead,
  type LeadStatus,
} from "../api";
import { colors } from "../theme";

interface Props {
  token: string;
  onLogout: () => void;
  onAdd: () => void;
  onEdit: (lead: Lead) => void;
  onScan: () => void;
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

async function registerPushToken(token: string) {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return;

    // Для Android 8+ нужен канал, иначе уведомление не покажется
    await Notifications.setNotificationChannelAsync("default", {
      name: "Новые заявки",
      importance: Notifications.AndroidImportance.HIGH,
    });

    // projectId обязателен для получения ExpoPushToken (Expo Go и EAS-сборки)
    const push = await Notifications.getExpoPushTokenAsync({
      projectId: Constants.easConfig?.projectId,
    });
    await api.registerPushToken(token, push.data);
  } catch (e) {
    // Уведомления не критичны — молча пропускаем
    console.warn("Push registration failed:", e);
  }
}

export function LeadsScreen({ token, onLogout, onAdd, onEdit, onScan }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      setError(null);
      try {
        const data = await api.leads(token);
        setLeads(data ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить заявки");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load();
    registerPushToken(token);

    // Перезагружаем список, когда приходит уведомление (приложение открыто)
    const sub = Notifications.addNotificationReceivedListener(() => load());
    const responseSub = Notifications.addNotificationResponseReceivedListener(() =>
      load(),
    );
    return () => {
      sub.remove();
      responseSub.remove();
    };
  }, [token, load]);

  const changeStatus = async (lead: Lead, next: LeadStatus) => {
    if (lead.status === next) return;
    // Оптимистично меняем сразу, при ошибке откатываем
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, status: next } : l)),
    );
    try {
      await api.updateLead(token, lead.id, { status: next });
    } catch (e) {
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, status: lead.status } : l)),
      );
      Alert.alert(
        "Ошибка",
        e instanceof Error ? e.message : "Не удалось обновить статус",
      );
    }
  };

  const statusChipStyle = (active: boolean, value: LeadStatus) => {
    const base = styles.statusChip;
    if (!active) return base;
    if (value === "urgent") return [base, styles.statusChipUrgent];
    if (value === "done") return [base, styles.statusChipDone];
    return [base, styles.statusChipNew];
  };

  const statusChipTextStyle = (active: boolean, value: LeadStatus) => {
    if (!active) return styles.statusChipText;
    if (value === "urgent") return [styles.statusChipText, styles.statusChipTextUrgent];
    if (value === "done") return [styles.statusChipText, styles.statusChipTextDone];
    return [styles.statusChipText, styles.statusChipTextNew];
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
              setLeads((prev) => prev.filter((l) => l.id !== lead.id));
            } catch (e) {
              Alert.alert(
                "Ошибка",
                e instanceof Error ? e.message : "Не удалось удалить",
              );
            }
          },
        },
      ],
    );
  };

  const renderCard = ({ item }: { item: Lead }) => (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        (item.status ?? "new") === "done" && styles.cardDone,
        pressed && { opacity: 0.8 },
      ]}
      onPress={() => onEdit(item)}
      onLongPress={() => confirmDelete(item)}
      delayLongPress={500}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardName}>{item.name}</Text>
        <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
      </View>
      <View style={styles.cardRow}>
        <Text style={styles.cardLabel}>📞 </Text>
        {item.phone ? (
          <Text style={styles.cardPhone}>{item.phone}</Text>
        ) : (
          <Text style={styles.cardPhoneMissing}>Без телефона ⚠</Text>
        )}
      </View>
      <View style={styles.chipRow}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{serviceLabel(item.service)}</Text>
        </View>
        <View style={styles.statusRow}>
          {LEAD_STATUSES.map((s) => {
            const active = (item.status ?? "new") === s.value;
            return (
              <Pressable
                key={s.value}
                onPress={() => changeStatus(item, s.value)}
                style={statusChipStyle(active, s.value)}
                hitSlop={6}
              >
                <Text style={statusChipTextStyle(active, s.value)}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={styles.cardAddress}>📍 {item.address}</Text>
      {item.comment ? (
        <Text style={styles.cardComment}>💬 {item.comment}</Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={styles.cardHint}>Нажмите, чтобы редактировать · удерживайте для удаления</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Заявки</Text>
          <Text style={styles.headerCount}>
            {leads.length > 0 ? `${leads.length} шт.` : " "}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={onScan} hitSlop={12} style={styles.scanButton}>
            <Text style={styles.scanButtonText}>📷 Блокнот</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.addButton,
              pressed && { opacity: 0.85 },
            ]}
            onPress={onAdd}
          >
            <Text style={styles.addButtonText}>+ Добавить</Text>
          </Pressable>
          <Pressable onPress={onLogout} hitSlop={12}>
            <Text style={styles.logout}>Выйти</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
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
          data={leads}
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
              <Text style={styles.empty}>Заявок пока нет</Text>
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  scanButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.inputBg,
  },
  scanButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addButtonText: {
    color: colors.primaryForeground,
    fontWeight: "700",
    fontSize: 14,
  },
  logout: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
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
  cardDate: {
    color: colors.textMuted,
    fontSize: 12,
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
  cardDone: {
    opacity: 0.6,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    flexWrap: "wrap",
  },
  statusChip: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
  },
  statusChipNew: {
    borderColor: colors.textMuted,
    backgroundColor: colors.textMuted,
  },
  statusChipUrgent: {
    borderColor: "#f59e0b",
    backgroundColor: "rgba(245,158,11,0.18)",
  },
  statusChipDone: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.18)",
  },
  statusChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  statusChipTextNew: {
    color: "#0a0a0a",
  },
  statusChipTextUrgent: {
    color: "#fbbf24",
  },
  statusChipTextDone: {
    color: "#4ade80",
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
    paddingTop: 8,
  },
  cardHint: {
    color: colors.textMuted,
    fontSize: 11,
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
  },
});

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
import * as Notifications from "expo-notifications";
import { api, serviceLabel, type Lead } from "../api";
import { colors } from "../theme";

interface Props {
  token: string;
  onLogout: () => void;
  onAdd: () => void;
  onEdit: (lead: Lead) => void;
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

    await Notifications.setNotificationChannelAsync("default", {
      name: "Новые заявки",
      importance: Notifications.AndroidImportance.HIGH,
    });

    const push = await Notifications.getExpoPushTokenAsync();
    await api.registerPushToken(token, push.data);
  } catch (e) {
    // Уведомления не критичны — молча пропускаем
    console.warn("Push registration failed:", e);
  }
}

export function LeadsScreen({ token, onLogout, onAdd, onEdit }: Props) {
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
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
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
        <Text style={styles.cardPhone}>{item.phone}</Text>
      </View>
      <View style={styles.chip}>
        <Text style={styles.chipText}>{serviceLabel(item.service)}</Text>
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
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Заявки</Text>
          <Text style={styles.headerCount}>
            {leads.length > 0 ? `${leads.length} шт.` : " "}
          </Text>
        </View>
        <View style={styles.headerActions}>
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
    </View>
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

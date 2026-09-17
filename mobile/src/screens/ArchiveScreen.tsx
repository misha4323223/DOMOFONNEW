import { useCallback, useEffect, useMemo, useState } from "react";
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
import { EmptyState } from "../components/EmptyState";
import { ListSkeleton } from "../components/Skeletons";
import { colors } from "../theme";
import { callPhone } from "../phone";
import { analyzeLeads, type ClientGroup } from "../repeats";

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
  // Раскрытые истории абонентов (ключ — id последней заявки)
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  // Заявки одного абонента — одной карточкой: телефон или адрес совпали.
  const groups = useMemo(() => (leads ? analyzeLeads(leads).groups : []), [leads]);

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
        // Нет связи — вернётся само, когда появится интернет.
        // Операция лежит в офлайн-очереди и отправится при появлении связи.
        await queueLeadUpdate(lead.id, { archived: "0" });
        Alert.alert(
          "Вернём позже",
          "Нет связи с сервером — заявка вернётся в список автоматически, как только интернет появится.",
        );
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

  /**
   * Карточка абонента.
   *
   * Заявки одного абонента показываются одной карточкой: так архив не пухнет
   * от повторных обращений. Показываем последнюю заявку, а остальные прячем
   * в «Историю» — она раскрывается по тапу, и там у каждого визита свои
   * кнопки «Вернуть» и «Удалить» (чтобы не удалить не то).
   */
  const renderGroup = ({ item }: { item: ClientGroup<Lead> }) => {
    const lead = item.latest;
    const several = item.leads.length > 1;
    const expanded = Boolean(opened[lead.id]);

    return (
      <View
        style={[
          styles.card,
          { borderLeftColor: "#22c55e", borderRightColor: "#22c55e" },
        ]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardName}>{lead.name}</Text>
          {several ? (
            <View style={styles.repeatBadge}>
              <Text style={styles.repeatBadgeText}>
                {item.byAddress && !item.byPhone ? "🏠" : "🔁"} {item.leads.length} заявки
              </Text>
            </View>
          ) : (
            <View style={styles.doneBadge}>
              <Text style={styles.doneBadgeText}>✓ Выполнена</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardAddress}>📍 {lead.address}</Text>
        <View style={styles.cardRow}>
          {/* Номер нажимается: тап — и звонок */}
          {lead.phone ? (
            <Pressable
              style={({ pressed }) => [
                styles.cardPhoneWrap,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => callPhone(lead.phone)}
              hitSlop={4}
            >
              <Text style={styles.cardPhone} numberOfLines={1}>
                📞 {lead.phone}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.cardPhone, styles.cardPhoneMissing]} numberOfLines={1}>
              📞 Без телефона
            </Text>
          )}
          <Text style={styles.cardDate}>{formatDate(lead.createdAt)}</Text>
        </View>
        {lead.comment ? (
          <Text style={styles.cardComment}>💬 {lead.comment}</Text>
        ) : null}

        {several ? (
          <View style={styles.cardFooter}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{serviceLabel(lead.service)}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.historyButton, pressed && { opacity: 0.8 }]}
              onPress={() =>
                setOpened((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }))
              }
              hitSlop={6}
            >
              <Text style={styles.historyButtonText}>
                {expanded ? "История ▴" : `все заявки: ${item.leads.length} ▾`}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.cardFooter}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{serviceLabel(lead.service)}</Text>
            </View>
            {busyId === lead.id ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <View style={styles.cardActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.actionRestore,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => restore(lead)}
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
                  onPress={() => confirmDelete(lead)}
                  hitSlop={6}
                >
                  <Text style={styles.actionDeleteText}>Удалить</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* История визитов: свои кнопки у каждой заявки */}
        {several && expanded ? (
          <View style={styles.visits}>
            {item.leads.map((visit) => (
              <View key={visit.id} style={styles.visitRow}>
                <View style={styles.visitText}>
                  <Text style={styles.visitDate}>{formatDate(visit.createdAt)}</Text>
                  <Text style={styles.visitService}>{serviceLabel(visit.service)}</Text>
                </View>
                {busyId === visit.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <View style={styles.cardActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionButton,
                        styles.actionRestore,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => restore(visit)}
                      hitSlop={6}
                    >
                      <Text style={styles.actionRestoreText}>↩</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [
                        styles.actionButton,
                        styles.actionDelete,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => confirmDelete(visit)}
                      hitSlop={6}
                    >
                      <Text style={styles.actionDeleteText}>✕</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : null}
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
            <Text style={styles.headerTitle}>Архив</Text>
            <Text style={styles.headerCount}>
              {leads
                ? `${leads.length} ${leads.length === 1 ? "заявка" : "заявок"}${
                    groups.length < leads.length ? ` · абонентов: ${groups.length}` : ""
                  }`
                : " "}
            </Text>
          </View>
        </View>
      </View>

      {leads === null && !error ? (
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
          data={groups}
          keyExtractor={(item) => item.leads.map((lead) => lead.id).join("|")}
          renderItem={renderGroup}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              iconName="archive-outline"
              title="Архив пуст"
              hint="Выполненные заявки отправляются сюда с главного экрана"
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
  list: {
    padding: 14,
    gap: 10,
    flexGrow: 1,
  },
  // Бадж «N заявки» у абонента, который обращался не один раз
  repeatBadge: {
    backgroundColor: "rgba(245,162,11,0.16)",
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.5)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  repeatBadgeText: {
    color: colors.primary,
    fontSize: 11.5,
    fontWeight: "800",
  },
  // Кнопка раскрытия истории визитов
  historyButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  historyButtonText: {
    color: colors.text,
    fontSize: 12.5,
    fontWeight: "700",
  },
  // Список визитов внутри карточки абонента
  visits: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    marginTop: 4,
    paddingTop: 6,
    gap: 6,
  },
  visitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  visitText: {
    flex: 1,
    gap: 1,
  },
  visitDate: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  visitService: {
    color: colors.textMuted,
    fontSize: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    // Зелёные полоски по бокам — карточка из архива (выполнена)
    borderLeftWidth: 4,
    borderLeftColor: "#22c55e",
    borderRightWidth: 4,
    borderRightColor: "#22c55e",
    padding: 12,
    gap: 5,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    // flex: 1 даёт тексту доступную ширину — имя переносится целиком,
    // а не сжимается в „…“ (баг Fabric с голым flexShrink)
    flex: 1,
  },
  doneBadge: {
    backgroundColor: "rgba(34,197,94,0.15)",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  doneBadgeText: {
    color: "#4ade80",
    fontSize: 10,
    fontWeight: "700",
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  // Обёртка номера: занимает свободное место перед датой
  cardPhoneWrap: {
    flex: 1,
  },
  // Номер телефона — зелёный, как кнопка «Позвонить» в списке заявок
  cardPhone: {
    color: "#4ade80",
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  cardPhoneMissing: {
    color: colors.destructive,
  },
  chip: {
    alignSelf: "flex-start",
    backgroundColor: colors.inputBg,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  cardDate: {
    color: colors.textMuted,
    fontSize: 11,
    // ЯВНАЯ ширина: в новой архитектуре RN (Fabric) текст без явной ширины
    // измеряется усечённым и режется многоточием («09.09.26, 00:…»). Дата
    // фиксированного формата (17 символов), ширины 116px хватает с запасом.
    width: 116,
    textAlign: "right",
    flexShrink: 0,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 8,
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
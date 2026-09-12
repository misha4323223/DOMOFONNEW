import { useCallback, useEffect, useMemo, useState } from "react";
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
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import {
  api,
  serviceLabel,
  LEAD_STATUSES,
  cacheLeads,
  getCachedLeads,
  cacheNotes,
  getCachedNotes,
  isNetworkError,
  isServerError,
  type Lead,
  type LeadStatus,
  type Note,
} from "../api";
import {
  flushPending,
  queueLeadDelete,
  queueLeadUpdate,
  useSyncState,
} from "../sync";
import { EmptyState } from "../components/EmptyState";
import { ListSkeleton } from "../components/Skeletons";
import { colors } from "../theme";
import {
  CRITICAL_DAYS,
  STALE_DAYS,
  leadsWord,
  staleInfo,
  staleSummary,
} from "../leadAge";
import { useRouteCity } from "../components/CityPicker";
import { callPhone } from "../phone";

interface Props {
  token: string;
  onEdit: (lead: Lead) => void;
}

/**
 * Привести строку к виду, удобному для поиска: нижний регистр, «ё» → «е».
 * Так «Ефремов» находится по запросу «ефремов», а «Ёлкин» — по «елкин».
 */
function forSearch(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е");
}

/** Только цифры: по ним ищем телефон, как бы он ни был записан. */
function digits(value: string): string {
  return value.replace(/\D/g, "");
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

export function LeadsScreen({ token, onEdit }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Флаг офлайн-режима: true когда нет подключения к серверу
  const [isOffline, setIsOffline] = useState(false);
  // Сколько изменений ждёт отправки (офлайн-очередь)
  const { pending: pendingCount, revision } = useSyncState();

  // Активные заявки — без ушедших в архив (archived === "1")
  const activeLeads = leads.filter((l) => l.archived !== "1");

  // Поиск по заявкам: имя/город, телефон, адрес, услуга, комментарий, заметки
  const [query, setQuery] = useState("");
  // Фильтр «только зависшие» — включается тапом по баннеру-предупреждению
  const [overdueOnly, setOverdueOnly] = useState(false);

  // Актуальные заметки, сгруппированные по заявке: нужны и для карточек,
  // и для поиска (в заметках часто адрес и детали заказа).
  const notesByLead = useMemo(() => {
    const map: Record<string, Note[]> = {};
    for (const note of notes) {
      if (!note.leadId || note.done === "1") continue;
      const list = map[note.leadId];
      if (list) list.push(note);
      else map[note.leadId] = [note];
    }
    return map;
  }, [notes]);

  // Сколько заявок висит больше недели (и сколько — больше двух)
  const staleStats = useMemo(() => staleSummary(activeLeads), [activeLeads]);

  /** Заявки с учётом поиска и фильтра «зависшие». */
  const visibleLeads = useMemo(() => {
    const q = forSearch(query.trim());
    const qDigits = digits(query);
    const found = activeLeads.filter((lead) => {
      if (overdueOnly && !staleInfo(lead)) return false;
      if (!q) return true;
      const notesText = (notesByLead[lead.id] ?? []).map((n) => n.text).join(" ");
      const haystack = forSearch(
        [
          lead.name,
          lead.address,
          lead.comment ?? "",
          serviceLabel(lead.service),
          lead.phone ?? "",
          notesText,
        ].join(" "),
      );
      if (haystack.includes(q)) return true;
      // Телефон ищем ещё и по цифрам: «8905113…» найдёт «+7 905 113 …»
      return qDigits.length >= 3 && digits(lead.phone ?? "").includes(qDigits);
    });

    // Зависшие — наверх (самые старые первыми): их и надо разобрать раньше.
    // Остальные — как обычно, свежие сверху.
    return found.sort((a, b) => {
      const ra = staleInfo(a) ? 0 : 1;
      const rb = staleInfo(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      return ra === 0 ? ta - tb : tb - ta;
    });
  }, [activeLeads, query, overdueOnly, notesByLead]);

  // После успешной отправки очереди (появился интернет) — перечитываем список,
  // чтобы локальные id созданных офлайн заявок заменились на настоящие.
  useEffect(() => {
    if (revision > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const load = useCallback(
    async (asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      setError(null);
      try {
        // Заявки и заметки грузим вместе: заметки нужны для привязки к карточкам
        const [data, notesData] = await Promise.all([
          api.leads(token),
          api.notes(token),
        ]);
        setLeads(data ?? []);
        setNotes(notesData ?? []);
        setIsOffline(false);
        // Сохраняем свежие данные в кеш
        await cacheLeads(data ?? []);
        await cacheNotes(notesData ?? []);
        // Связь есть — проталкиваем накопленные офлайн-изменения
        await flushPending(token);
      } catch (e) {
        // При ошибке сети — пробуем показать кеш
        const cached = await getCachedLeads();
        if (cached.length > 0) {
          setLeads(cached);
          setIsOffline(true);
          setError(null);
        }
        const cachedNotes = await getCachedNotes();
        if (cachedNotes.length > 0) {
          setNotes(cachedNotes);
        }
        if (cached.length === 0) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить заявки");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    // Сначала показываем кеш мгновенно (без спиннера), потом обновляем
    (async () => {
      const cached = await getCachedLeads();
      if (cached.length > 0) {
        setLeads(cached);
        setLoading(false);
      }
      // Запускаем загрузку с сервера
      load();
    })();

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
    // Оптимистично меняем сразу
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, status: next } : l)),
    );
    try {
      await api.updateLead(token, lead.id, { status: next });
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — изменение кладём в очередь: отправится само,
        // когда интернет появится.
        await queueLeadUpdate(lead.id, { status: next });
      } else {
        // Сервер отверг (например, токен протух) — откатываем и показываем
        setLeads((prev) =>
          prev.map((l) => (l.id === lead.id ? { ...l, status: lead.status } : l)),
        );
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось обновить статус",
        );
      }
    }
  };

  const statusChipStyle = (active: boolean, value: LeadStatus) => {
    const base = styles.statusChip;
    if (!active) return base;
    if (value === "urgent") return [base, styles.statusChipUrgent];
    if (value === "done") return [base, styles.statusChipDone];
    return [base, styles.statusChipNew];
  };

  // Маршрут до адреса: если город не понятен из заявки — спросим (окно picker)
  const { openRoute, picker } = useRouteCity();

  const statusChipTextStyle = (active: boolean, value: LeadStatus) => {
    if (!active) return styles.statusChipText;
    if (value === "urgent") return [styles.statusChipText, styles.statusChipTextUrgent];
    if (value === "done") return [styles.statusChipText, styles.statusChipTextDone];
    return [styles.statusChipText, styles.statusChipTextNew];
  };

  /** Отправить выполненную заявку в архив. */
  const confirmArchive = (lead: Lead) => {
    Alert.alert(
      "Отправить в архив?",
      `${lead.name} — ${serviceLabel(lead.service)}`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "В архив",
          onPress: async () => {
            // Оптимистично убираем заявку из активного списка
            setLeads((prev) =>
              prev.map((l) => (l.id === lead.id ? { ...l, archived: "1" } : l)),
            );
            try {
              await api.updateLead(token, lead.id, { archived: "1" });
            } catch (e) {
              if (isNetworkError(e) || isServerError(e)) {
                // Нет связи — уйдёт в архив само, когда появится интернет.
                // Операция лежит в офлайн-очереди и отправится при появлении связи
                // (очередь больше НЕ выбрасывает операции по времени).
                await queueLeadUpdate(lead.id, { archived: "1" });
                Alert.alert(
                  "Отправим в архив позже",
                  "Нет связи с сервером — заявка уйдёт в архив автоматически, как только интернет появится.",
                );
              } else {
                // Сервер отверг — откатываем
                setLeads((prev) =>
                  prev.map((l) => (l.id === lead.id ? { ...l, archived: "0" } : l)),
                );
                Alert.alert(
                  "Ошибка",
                  e instanceof Error ? e.message : "Не удалось отправить в архив",
                );
              }
            }
          },
        },
      ],
    );
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
              if (isNetworkError(e) || isServerError(e)) {
                // Нет связи — удаление применится, когда появится интернет
                await queueLeadDelete(lead.id);
                setLeads((prev) => prev.filter((l) => l.id !== lead.id));
              } else {
                Alert.alert(
                  "Ошибка",
                  e instanceof Error ? e.message : "Не удалось удалить",
                );
              }
            }
          },
        },
      ],
    );
  };

  /** Цвет боковой полоски карточки по статусу. */
  const statusColor = (value: LeadStatus) => {
    if (value === "urgent") return "#f87171";
    if (value === "done") return "#22c55e";
    return "#f5a20b";
  };

  const renderCard = ({ item }: { item: Lead }) => {
    const status = item.status ?? "new";
    // Актуальные (невыполненные) заметки, привязанные к этой заявке
    const leadNotesAll = notesByLead[item.id] ?? [];
    const leadNotes = leadNotesAll.slice(0, 3);
    const leadNotesTotal = leadNotesAll.length;
    // Если заявка висит больше недели — показываем предупреждение
    const stale = staleInfo(item);
    // Цвет статуса — им подсвечены обе боковые полоски карточки
    const accent = statusColor(status);
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          { borderLeftColor: accent, borderRightColor: accent },
          status === "done" && styles.cardDone,
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => onEdit(item)}
        onLongPress={() => confirmDelete(item)}
        delayLongPress={500}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleWrap}>
            <Text style={styles.cardName}>{item.name}</Text>
            {item.source === "admin" && (
              <View style={styles.manualBadge}>
                <Text style={styles.manualBadgeText}>✍️ Вручную</Text>
              </View>
            )}
          </View>
          <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
        </View>
        {/* Предупреждение: заявка висит больше недели — пора звонить клиенту */}
        {stale ? (
          <View
            style={[
              styles.staleRow,
              stale.level === "critical" && styles.staleRowCritical,
            ]}
          >
            <Ionicons
              name={stale.level === "critical" ? "alert-circle" : "time-outline"}
              size={13}
              color={stale.level === "critical" ? "#f87171" : "#fbbf24"}
            />
            <Text
              style={[
                styles.staleRowText,
                stale.level === "critical" && styles.staleRowTextCritical,
              ]}
              numberOfLines={1}
            >
              Заявка {stale.text}
            </Text>
          </View>
        ) : null}
        {/* Адрес — тап открывает навигатор: нажал и едешь */}
        {item.address.trim() ? (
          <Pressable
            style={({ pressed }) => [
              styles.addressRow,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => openRoute(item)}
            hitSlop={4}
          >
            <Text style={styles.cardAddress} numberOfLines={2}>
              📍 {item.address}
            </Text>
            <View style={styles.routeButton}>
              <Ionicons name="navigate" size={12} color={colors.primary} />
              <Text style={styles.routeButtonText}>Маршрут</Text>
            </View>
          </Pressable>
        ) : (
          <Text style={styles.cardAddress}>📍 {item.address}</Text>
        )}
        <View style={styles.cardRow}>
          {/* Номер тоже нажимается: тап — и звонок */}
          {item.phone ? (
            <Pressable
              style={({ pressed }) => [
                styles.cardPhoneWrap,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => callPhone(item.phone)}
              hitSlop={4}
            >
              <Text style={styles.cardPhone} numberOfLines={1}>
                📞 {item.phone}
              </Text>
            </Pressable>
          ) : (
            <Text style={[styles.cardPhone, styles.cardPhoneMissing]} numberOfLines={1}>
              📞 Без телефона ⚠
            </Text>
          )}
          <View style={styles.chip}>
            <Text style={styles.chipText}>{serviceLabel(item.service)}</Text>
          </View>
        </View>
        {item.comment ? (
          <Text style={styles.cardComment}>💬 {item.comment}</Text>
        ) : null}
        {leadNotes.length > 0 ? (
          <View style={styles.notesBlock}>
            {leadNotes.map((n) => (
              <Text key={n.id} style={styles.cardNote} numberOfLines={1}>
                📌 {n.text}
              </Text>
            ))}
            {leadNotesTotal > leadNotes.length ? (
              <Text style={styles.cardNoteMore}>
                📌 ещё {leadNotesTotal - leadNotes.length}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.cardFooter}>
          <View style={styles.statusRow}>
            {LEAD_STATUSES.map((s) => {
              const active = status === s.value;
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
          {/* Действия по заявке: позвонить можно с любой карточки */}
          <View style={styles.footerActions}>
            {item.phone ? (
              <Pressable
                style={({ pressed }) => [
                  styles.callButton,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => callPhone(item.phone)}
                hitSlop={6}
              >
                <Ionicons
                  name="call"
                  size={13}
                  color={colors.primaryForeground}
                />
                <Text style={styles.callButtonText}>Позвонить</Text>
              </Pressable>
            ) : null}
            {status === "done" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.archiveButton,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => confirmArchive(item)}
                hitSlop={6}
              >
                <Text style={styles.archiveButtonText}>🗄 В архив</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>Заявки</Text>
            <Text style={styles.headerCount} numberOfLines={1}>
              {query.trim()
                ? `Найдено: ${visibleLeads.length} из ${activeLeads.length}`
                : activeLeads.length > 0
                  ? `${activeLeads.length} шт.`
                  : " "}
            </Text>
          </View>

          {/* Поиск по заявкам: имя/город, адрес, телефон, услуга, комментарий */}
          <View style={styles.search}>
            <Ionicons name="search" size={15} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск"
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Предупреждение о заявках, которые висят больше недели.
          Тап по плашке оставляет в списке только их. */}
      {staleStats.count > 0 ? (
        <Pressable
          style={({ pressed }) => [
            styles.staleBanner,
            staleStats.critical > 0 && styles.staleBannerCritical,
            pressed && { opacity: 0.85 },
          ]}
          onPress={() => setOverdueOnly((v) => !v)}
        >
          <Ionicons
            name={staleStats.critical > 0 ? "alert-circle" : "time-outline"}
            size={17}
            color={staleStats.critical > 0 ? "#f87171" : "#fbbf24"}
          />
          <Text
            style={[
              styles.staleBannerText,
              staleStats.critical > 0 && styles.staleBannerTextCritical,
            ]}
          >
            {staleStats.critical > 0
              ? `${staleStats.critical} ${leadsWord(staleStats.critical)} ` +
                `${staleStats.critical === 1 ? "висит" : "висят"} больше ${CRITICAL_DAYS} дней`
              : `${staleStats.count} ${leadsWord(staleStats.count)} ` +
                `${staleStats.count === 1 ? "висит" : "висят"} больше ${STALE_DAYS} дней`}
          </Text>
          <Text
            style={[
              styles.staleBannerAction,
              staleStats.critical > 0 && styles.staleBannerTextCritical,
            ]}
          >
            {overdueOnly ? "Все" : "Показать"}
          </Text>
        </Pressable>
      ) : null}

      {/* Плашка офлайн-режима / ожидающих отправки изменений */}
      {(isOffline || pendingCount > 0) && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            📡 Офлайн-режим
            {pendingCount > 0
              ? ` · ${pendingCount} измен. ждут отправки`
              : " · данные могут быть неактуальны"}
          </Text>
        </View>
      )}
      {loading && leads.length === 0 ? (
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
          data={visibleLeads}
          keyExtractor={(item) => item.id}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            query.trim() || overdueOnly ? (
              <EmptyState
                iconName="search-outline"
                title="Ничего не найдено"
                hint={
                  query.trim()
                    ? `По запросу «${query.trim()}» заявок нет`
                    : "Заявок старше недели нет — всё разобрано"
                }
              />
            ) : (
              <EmptyState
                iconName="clipboard-outline"
                title="Заявок пока нет"
                hint="Новые заявки с сайта появятся здесь автоматически"
              />
            )
          }
        />
      )}

      {/* Окно выбора города — показывается, только когда город не ясен из заявки */}
      {picker}
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
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerLeft: {
    // Сжимается, но не выталкивает поиск за край экрана
    flexShrink: 1,
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
  // Поле поиска в шапке (справа от заголовка)
  search: {
    flex: 1,
    maxWidth: 210,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    // Android добавляет свои внутренние отступы — убираем, чтобы текст
    // стоял по центру поля
    padding: 0,
    height: 36,
  },
  // Плашка-предупреждение о зависших заявках
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(245,158,11,0.14)",
    borderBottomWidth: 1,
    borderBottomColor: "#f59e0b",
  },
  staleBannerCritical: {
    backgroundColor: "rgba(239,68,68,0.16)",
    borderBottomColor: colors.destructive,
  },
  staleBannerText: {
    flex: 1,
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "700",
  },
  staleBannerTextCritical: {
    color: "#f87171",
  },
  staleBannerAction: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    opacity: 0.9,
  },
  list: {
    padding: 14,
    gap: 10,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    // Цветные полоски по бокам показывают статус заявки (обе — одного цвета)
    borderLeftWidth: 4,
    borderLeftColor: "#f5a20b",
    borderRightWidth: 4,
    borderRightColor: "#f5a20b",
    padding: 12,
    gap: 5,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    // Явное сжатие: иначе при длинном имени/бейдже дата выталкивается за край карточки
    flexShrink: 1,
  },
  cardName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    // flex: 1 (а не голый flexShrink) — имя получает доступную ширину и
    // переносится целиком, а не сжимается в „…“ (баг Fabric), выталкивая дату
    flex: 1,
  },
  // Метка «Вручную»: заявку добавил админ через «+ Добавить», а не клиент с сайта
  manualBadge: {
    backgroundColor: "rgba(245,162,11,0.14)",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.45)",
  },
  manualBadgeText: {
    color: "#f5a20b",
    fontSize: 10,
    fontWeight: "700",
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
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  // Обёртка номера: занимает свободное место, чтобы чип услуги остался справа
  cardPhoneWrap: {
    flex: 1,
  },
  cardPhone: {
    color: colors.primary,
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
  cardDone: {
    opacity: 0.7,
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
  // Адрес + кнопка «в навигатор»: тап по всей строке открывает карты
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  cardAddress: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  routeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(245,162,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.45)",
  },
  routeButtonText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  // Строка-предупреждение внутри карточки зависшей заявки
  staleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
  },
  staleRowCritical: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderColor: "rgba(239,68,68,0.45)",
  },
  staleRowText: {
    flex: 1,
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "600",
  },
  staleRowTextCritical: {
    color: "#f87171",
  },
  // Действия в нижней строке карточки: «Позвонить» и «В архив»
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  callButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primary,
  },
  callButtonText: {
    color: colors.primaryForeground,
    fontSize: 12,
    fontWeight: "800",
  },
  notesBlock: {
    gap: 2,
    marginTop: 2,
  },
  cardNote: {
    color: "#f5a20b",
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  cardNoteMore: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
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
  // Кнопка «В архив» на выполненных заявках
  archiveButton: {
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.55)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(245,162,11,0.14)",
  },
  archiveButtonText: {
    color: "#f5a20b",
    fontSize: 12,
    fontWeight: "700",
  },
  offlineBanner: {
    backgroundColor: "rgba(245,158,11,0.15)",
    borderBottomWidth: 1,
    borderBottomColor: "#f59e0b",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  offlineText: {
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
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

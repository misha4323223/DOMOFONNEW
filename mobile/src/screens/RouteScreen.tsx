/**
 * Маршрут на день.
 *
 * Мастер отбирает заявки, приложение само выстраивает их по порядку объезда
 * (город → улица → дом). Дальше режим рейса: на экране одна текущая заявка —
 * адрес, клиент, телефон, расходники. Нажал «Навигатор», доехал, выполнил —
 * и сразу подставляется следующая. Заявка при этом закрывается обычным
 * способом (статус «Выполнена»), поэтому расходники списываются как всегда.
 *
 * Маршрут хранится на сервере (общий для всех телефонов админов) и в телефоне
 * (чтобы работать без интернета) — см. mobile/src/route.ts. Интерфейса в
 * веб-админке нет: маршрут живёт только в приложении.
 *
 * В рейсе маршрут можно дополнить: кнопка «+ Добавить точку» открывает список
 * свободных заявок, выбранная встаёт сразу после текущей точки — заехать
 * по пути, не сбивая остальной порядок.
 *
 * Порядок можно задать и вручную — стрелками ↑↓ рядом с точкой (и в сборке
 * маршрута, и в рейсе): точка меняется местами с соседней. Автосортировка
 * «по городам и улицам» при этом остаётся кнопкой и всегда может вернуть
 * порядок, если руками получилось неудачно.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  api,
  cacheLeads,
  emptyRoutePlan,
  formatQty,
  getCachedLeads,
  isNetworkError,
  isServerError,
  serviceLabel,
  type Lead,
  type RoutePlan,
} from "../api";
import { queueLeadUpdate, useSyncState } from "../sync";
import { EmptyState } from "../components/EmptyState";
import { ListSkeleton } from "../components/Skeletons";
import { useRouteCity } from "../components/CityPicker";
import { callPhone } from "../phone";
import { leadCity } from "../maps";
import { MapScreen, isMapAvailable, type MapStop } from "./MapScreen";
import { colors } from "../theme";
import {
  canMoveStop,
  currentStopId,
  groupByCity,
  insertStopAfterCurrent,
  loadLocalRoute,
  moveStop,
  moveStopToCurrent,
  pushRoutePlan,
  routeProgress,
  skipCurrentStop,
  sortLeadsForRoute,
  syncRoutePlan,
  touchRoutePlan,
} from "../route";

interface Props {
  token: string;
  onBack: () => void;
  /** Открыть заявку целиком (правка, заметки, расходники). */
  onOpenLead: (lead: Lead) => void;
}

/** Склонение: plural(2, ["заявка", "заявки", "заявок"]) → «заявки». */
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

export function RouteScreen({ token, onBack, onOpenLead }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [plan, setPlan] = useState<RoutePlan>(emptyRoutePlan);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  // Окно «добавить точку в начатый маршрут» и подтверждение последнего добавления
  const [addOpen, setAddOpen] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  // Карта маршрута — отдельный экран поверх приложения
  const [mapOpen, setMapOpen] = useState(false);
  const { revision } = useSyncState();

  const running = plan.startedAt !== null;

  /** Активные заявки: архивные в маршрут не берём. */
  const activeLeads = useMemo(
    () => leads.filter((l) => l.archived !== "1"),
    [leads],
  );
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  /** Точки плана, которые ещё существуют и не в архиве. */
  const stops = useMemo(
    () => plan.stops.filter((id) => byId.get(id)?.archived !== "1"),
    [plan.stops, byId],
  );

  const currentId = useMemo(
    () => currentStopId({ ...plan, stops }, leads),
    [plan, stops, leads],
  );
  const currentLead = currentId ? byId.get(currentId) ?? null : null;
  const doneCount = useMemo(
    () => routeProgress({ ...plan, stops }, leads),
    [plan, stops, leads],
  );

  /**
   * Точки для карты: адрес, город (он уточняет поиск) и признак «выполнена».
   * Порядок тот же, что в плане объезда — на карте номера совпадают со списком.
   */
  const mapStops = useMemo<MapStop[]>(
    () =>
      stops.map((id) => {
        const lead = byId.get(id);
        return {
          id,
          name: lead?.name ?? "",
          address: lead?.address ?? "",
          city: lead ? (leadCity(lead) ?? undefined) : undefined,
          done: lead?.status === "done",
        };
      }),
    [stops, byId],
  );

  const load = useCallback(
    async (asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      setError(null);
      try {
        const data = (await api.leads(token)) ?? [];
        setLeads(data);
        await cacheLeads(data);
        setIsOffline(false);
        // План: свой из телефона + сверка с сервером (кто свежее — того и правда)
        const local = await loadLocalRoute();
        setPlan(await syncRoutePlan(token, local));
      } catch (e) {
        const cached = await getCachedLeads();
        if (cached.length > 0) {
          setLeads(cached);
          setIsOffline(true);
        } else {
          setError(e instanceof Error ? e.message : "Не удалось загрузить заявки");
        }
        // Без сети маршрут всё равно должен открыться — берём план из телефона
        setPlan(await loadLocalRoute());
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // После отправки офлайн-очереди перечитываем заявки и маршрут
  useEffect(() => {
    if (revision > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  /** Сохранить план (телефон + сервер) и обновить экран. */
  const savePlan = useCallback(
    async (next: RoutePlan) => {
      setPlan(next);
      const saved = await pushRoutePlan(token, next);
      setPlan(saved);
    },
    [token],
  );

  // Заявку удалили или убрали в архив — точка уходит из маршрута
  useEffect(() => {
    if (loading || leads.length === 0 || plan.stops.length === 0) return;
    if (stops.length === plan.stops.length) return;
    void savePlan(touchRoutePlan(stops, plan.startedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, leads, loading]);

  /** Свободные заявки: их можно добавить в уже начатый маршрут. */
  const addCandidates = useMemo(
    () => activeLeads.filter((l) => l.status !== "done" && !stops.includes(l.id)),
    [activeLeads, stops],
  );
  const addGroups = useMemo(() => groupByCity(addCandidates), [addCandidates]);

  /** Добавить заявку в рейс: встаёт сразу после текущей точки. */
  const addStopToRoute = (lead: Lead) => {
    const next = insertStopAfterCurrent({ ...plan, stops }, leads, lead.id);
    setLastAdded(lead.address.trim() || lead.name);
    void savePlan(touchRoutePlan(next, plan.startedAt));
  };

  /** Добавить/убрать заявку: новая точка сразу встаёт на своё место по порядку. */
  const toggleStop = (lead: Lead) => {
    const selected = plan.stops.includes(lead.id);
    if (selected) {
      void savePlan(touchRoutePlan(stops.filter((id) => id !== lead.id), plan.startedAt));
      return;
    }
    const ids = [...stops, lead.id];
    const ordered = sortLeadsForRoute(
      leads.filter((l) => ids.includes(l.id)),
    ).map((l) => l.id);
    void savePlan(touchRoutePlan(ordered, plan.startedAt));
  };

  const startRoute = () => {
    if (stops.length === 0) return;
    void savePlan(touchRoutePlan(stops, new Date().toISOString()));
  };

  const resorter = () => {
    const ordered = sortLeadsForRoute(
      stops.map((id) => byId.get(id)).filter((l): l is Lead => Boolean(l)),
    ).map((l) => l.id);
    void savePlan(touchRoutePlan(ordered, plan.startedAt));
  };

  /** Сдвинуть точку вверх/вниз: порядок объезда мастер задаёт сам. */
  const moveStopBy = (id: string, direction: -1 | 1) => {
    const next = moveStop({ ...plan, stops }, leads, id, direction);
    if (next === plan.stops) return;
    void savePlan(touchRoutePlan(next, plan.startedAt));
  };

  /** Стрелки ↑↓ для точки: вверх/вниз по порядку объезда. */
  const renderOrderButtons = (id: string) => {
    const planWithStops = { ...plan, stops };
    const up = canMoveStop(planWithStops, leads, id, -1);
    const down = canMoveStop(planWithStops, leads, id, 1);
    return (
      <View style={styles.orderButtons}>
        <Pressable
          onPress={() => moveStopBy(id, -1)}
          disabled={!up}
          hitSlop={8}
          style={({ pressed }) => [styles.orderButton, pressed && { opacity: 0.6 }]}
        >
          <Ionicons
            name="chevron-up"
            size={16}
            color={up ? colors.primary : colors.cardBorder}
          />
        </Pressable>
        <Pressable
          onPress={() => moveStopBy(id, 1)}
          disabled={!down}
          hitSlop={8}
          style={({ pressed }) => [styles.orderButton, pressed && { opacity: 0.6 }]}
        >
          <Ionicons
            name="chevron-down"
            size={16}
            color={down ? colors.primary : colors.cardBorder}
          />
        </Pressable>
      </View>
    );
  };

  /** Закрыть заявку: тот же путь, что и в списке заявок (и в офлайне). */
  const applyDone = async (lead: Lead) => {
    setLeads((prev) =>
      prev.map((l) => (l.id === lead.id ? { ...l, status: "done" as const } : l)),
    );
    try {
      await api.updateLead(token, lead.id, { status: "done" });
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — изменение уходит в общую очередь и применится само
        await queueLeadUpdate(lead.id, { status: "done" });
      } else {
        setLeads((prev) =>
          prev.map((l) => (l.id === lead.id ? { ...l, status: lead.status } : l)),
        );
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось выполнить заявку",
        );
      }
    }
  };

  const finishCurrent = (lead: Lead) => {
    const parts = lead.parts ?? [];
    if (parts.length > 0 && lead.partsDone !== "1") {
      Alert.alert(
        "Выполнить заявку?",
        `С остатка спишется: ${parts
          .map((p) => `${p.name} ×${formatQty(p.qty)}`)
          .join(", ")}.`,
        [
          { text: "Отмена", style: "cancel" },
          { text: "Выполнена", onPress: () => void applyDone(lead) },
        ],
      );
      return;
    }
    void applyDone(lead);
  };

  const confirmFinishRoute = () => {
    Alert.alert(
      "Завершить маршрут?",
      stops.length > doneCount
        ? `Невыполненные заявки (${stops.length - doneCount}) останутся в списке заявок.`
        : "Все заявки маршрута выполнены.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Завершить",
          onPress: () => void savePlan(emptyRoutePlan()),
        },
      ],
    );
  };

  // Маршрут до адреса: если город не ясен из заявки — приложение спросит его
  const { openRoute, picker } = useRouteCity();

  const subtitle = running
    ? `${doneCount} из ${stops.length} ${plural(stops.length, ["заявки", "заявок", "заявок"])}`
    : stops.length > 0
      ? `${stops.length} ${plural(stops.length, ["заявка", "заявки", "заявок"])} в маршруте`
      : "соберите маршрут на день";

  const selectedSet = new Set(stops);
  const groups = useMemo(() => groupByCity(activeLeads), [activeLeads]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
          <Text style={styles.backText}>‹ Назад</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Маршрут</Text>
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        </View>
        {running ? (
          <Pressable onPress={confirmFinishRoute} style={styles.headerAction} hitSlop={8}>
            <Text style={styles.headerActionText}>Стоп</Text>
          </Pressable>
        ) : (
          <View style={styles.headerAction} />
        )}
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            📡 Офлайн-режим · маршрут хранится в телефоне
          </Text>
        </View>
      )}

      {loading && leads.length === 0 ? (
        <ListSkeleton />
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={() => void load()}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.primary}
            />
          }
        >
          {/* --- Режим рейса --- */}
          {running && currentLead ? (
            <>
              <View style={styles.progressCard}>
                <View style={styles.progressHead}>
                  <Text style={styles.progressTitle}>
                    Выполнено {doneCount} из {stops.length}
                  </Text>
                  <Text style={styles.progressHint}>
                    {stops.length - doneCount} осталось
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${stops.length > 0 ? Math.round((doneCount / stops.length) * 100) : 0}%`,
                      },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.currentCard}>
                <View style={styles.currentTop}>
                  <View style={styles.currentNumber}>
                    <Text style={styles.currentNumberText}>
                      №{stops.indexOf(currentLead.id) + 1}
                    </Text>
                  </View>
                  <View style={styles.currentTopText}>
                    <Text style={styles.currentAddress}>{currentLead.address}</Text>
                    {currentLead.status === "urgent" ? (
                      <Text style={styles.urgentText}>🔥 Срочная заявка</Text>
                    ) : null}
                  </View>
                </View>

                <Text style={styles.currentName}>{currentLead.name}</Text>
                <Text style={styles.currentService}>
                  {serviceLabel(currentLead.service)}
                </Text>

                {currentLead.phone ? (
                  <Pressable
                    style={({ pressed }) => [styles.phoneRow, pressed && { opacity: 0.75 }]}
                    onPress={() => callPhone(currentLead.phone)}
                    hitSlop={4}
                  >
                    <Ionicons name="call" size={15} color="#4ade80" />
                    <Text style={styles.phoneText}>{currentLead.phone}</Text>
                  </Pressable>
                ) : null}

                {currentLead.comment ? (
                  <Text style={styles.currentComment}>💬 {currentLead.comment}</Text>
                ) : null}

                {(currentLead.parts ?? []).length > 0 ? (
                  <View style={styles.partsRow}>
                    <Ionicons name="cube-outline" size={13} color={colors.textMuted} />
                    <Text style={styles.partsText} numberOfLines={2}>
                      {(currentLead.parts ?? [])
                        .map((p) => `${p.name} ×${formatQty(p.qty)}`)
                        .join(", ")}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.navRow}>
                  {/* Кнопка карты — только там, где APK умеет её показать */}
                  {isMapAvailable ? (
                    <Pressable
                      style={({ pressed }) => [styles.mapButton, pressed && { opacity: 0.85 }]}
                      onPress={() => setMapOpen(true)}
                    >
                      <Ionicons name="map" size={17} color={colors.primary} />
                      <Text style={styles.mapButtonText}>Карта маршрута</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.85 }]}
                    onPress={() => void openRoute(currentLead)}
                  >
                    <Ionicons name="navigate" size={17} color={colors.primaryForeground} />
                    <Text style={styles.navButtonText}>Навигатор</Text>
                  </Pressable>
                </View>

                <View style={styles.actionRow}>
                  <Pressable
                    style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
                    onPress={() => onOpenLead(currentLead)}
                  >
                    <Ionicons name="create-outline" size={15} color={colors.text} />
                    <Text style={styles.actionButtonText}>Открыть</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.8 }]}
                    onPress={() => void savePlan(
                      touchRoutePlan(skipCurrentStop({ ...plan, stops }, leads), plan.startedAt),
                    )}
                  >
                    <Ionicons name="play-skip-forward-outline" size={15} color={colors.text} />
                    <Text style={styles.actionButtonText}>Пропустить</Text>
                  </Pressable>
                </View>

                <Pressable
                  style={({ pressed }) => [styles.doneButton, pressed && { opacity: 0.85 }]}
                  onPress={() => finishCurrent(currentLead)}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#bbf7d0" />
                  <Text style={styles.doneButtonText}>Выполнена — дальше</Text>
                </Pressable>
              </View>

              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, styles.sectionTitleRow]}>
                  Остальные точки
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.addStopButton,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => {
                    setLastAdded(null);
                    setAddOpen(true);
                  }}
                  hitSlop={6}
                >
                  <Ionicons name="add" size={15} color={colors.primary} />
                  <Text style={styles.addStopText}>Добавить точку</Text>
                </Pressable>
              </View>
              {stops.map((id, index) => {
                const lead = byId.get(id);
                if (!lead) return null;
                const done = lead.status === "done";
                const isCurrent = id === currentId;
                return (
                  <Pressable
                    key={id}
                    style={({ pressed }) => [
                      styles.stopRow,
                      done && styles.stopRowDone,
                      isCurrent && styles.stopRowCurrent,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => {
                      // Тап по точке — заехать в неё следующей
                      if (done) return;
                      void savePlan(
                        touchRoutePlan(moveStopToCurrent({ ...plan, stops }, leads, id), plan.startedAt),
                      );
                    }}
                  >
                    <View style={[styles.stopNumber, done && styles.stopNumberDone]}>
                      <Text style={styles.stopNumberText}>{done ? "✓" : index + 1}</Text>
                    </View>
                    {done ? null : renderOrderButtons(id)}
                    <View style={styles.stopText}>
                      <Text
                        style={[styles.stopAddress, done && styles.stopTextDone]}
                        numberOfLines={1}
                      >
                        {lead.address || "адрес не указан"}
                      </Text>
                      <Text style={styles.stopMeta} numberOfLines={1}>
                        {lead.name} · {serviceLabel(lead.service)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* Все точки пройдены (или заявки ушли в архив — маршрут пуст) */}
          {running && !currentLead ? (
            <View style={styles.finishCard}>
              <Ionicons name="trophy-outline" size={34} color={colors.primary} />
              <Text style={styles.finishTitle}>Маршрут выполнен</Text>
              <Text style={styles.finishHint}>
                {stops.length > 0
                  ? `Все ${stops.length} ${plural(stops.length, ["заявка", "заявки", "заявок"])} закрыты. Не забудьте отправить их в архив, если этого требует работа.`
                  : "Точек в маршруте не осталось: заявки выполнены или убраны в архив."}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.startButton, pressed && { opacity: 0.85 }]}
                onPress={confirmFinishRoute}
              >
                <Text style={styles.startButtonText}>Завершить маршрут</Text>
              </Pressable>
            </View>
          ) : null}

          {/* --- Режим сборки маршрута --- */}
          {!running && stops.length > 0 ? (
            <>
              <View style={styles.planCard}>
                <View style={styles.planHead}>
                  <Text style={styles.sectionTitle}>Порядок объезда</Text>
                  <Pressable onPress={resorter} hitSlop={6} style={styles.resortButton}>
                    <Ionicons name="swap-vertical" size={14} color={colors.primary} />
                    <Text style={styles.resortText}>по городам и улицам</Text>
                  </Pressable>
                </View>
                {stops.map((id, index) => {
                  const lead = byId.get(id);
                  if (!lead) return null;
                  return (
                    <View key={id} style={styles.planRow}>
                      <View style={styles.planNumber}>
                        <Text style={styles.planNumberText}>{index + 1}</Text>
                      </View>
                      <View style={styles.stopText}>
                        <Text style={styles.stopAddress} numberOfLines={1}>
                          {lead.address || "адрес не указан"}
                        </Text>
                        <Text style={styles.stopMeta} numberOfLines={1}>
                          {lead.name} · {serviceLabel(lead.service)}
                        </Text>
                      </View>
                      {renderOrderButtons(id)}
                      <Pressable
                        onPress={() => toggleStop(lead)}
                        hitSlop={8}
                        style={styles.removeButton}
                      >
                        <Ionicons name="close" size={16} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {isMapAvailable ? (
                <Pressable
                  style={({ pressed }) => [styles.mapPreviewButton, pressed && { opacity: 0.85 }]}
                  onPress={() => setMapOpen(true)}
                >
                  <Ionicons name="map-outline" size={16} color={colors.primary} />
                  <Text style={styles.mapPreviewText}>Посмотреть на карте</Text>
                </Pressable>
              ) : null}

              <Pressable
                style={({ pressed }) => [styles.startButton, pressed && { opacity: 0.85 }]}
                onPress={startRoute}
              >
                <Ionicons name="car-sport" size={18} color={colors.primaryForeground} />
                <Text style={styles.startButtonText}>
                  Поехали · {stops.length} {plural(stops.length, ["точка", "точки", "точек"])}
                </Text>
              </Pressable>
            </>
          ) : null}

          {/* --- Выбор заявок --- */}
          {!running ? (
            <>
              <Text style={styles.sectionTitle}>
                {stops.length > 0 ? "Добавить заявки" : "Выберите заявки на сегодня"}
              </Text>
              {activeLeads.length === 0 ? (
                <EmptyState
                  iconName="clipboard-outline"
                  title="Активных заявок нет"
                  hint="Новые заявки с сайта появятся здесь автоматически"
                />
              ) : (
                groups.map((group) => (
                  <View key={group.city}>
                    <Text style={styles.cityTitle}>{group.city}</Text>
                    {group.leads.map((lead) => {
                      const selected = selectedSet.has(lead.id);
                      return (
                        <Pressable
                          key={lead.id}
                          style={({ pressed }) => [
                            styles.pickRow,
                            selected && styles.pickRowSelected,
                            pressed && { opacity: 0.8 },
                          ]}
                          onPress={() => toggleStop(lead)}
                        >
                          <Ionicons
                            name={selected ? "checkbox" : "square-outline"}
                            size={21}
                            color={selected ? colors.primary : colors.textMuted}
                          />
                          <View style={styles.stopText}>
                            <Text style={styles.stopAddress} numberOfLines={1}>
                              {lead.address || "адрес не указан"}
                            </Text>
                            <Text style={styles.stopMeta} numberOfLines={1}>
                              {lead.name} · {serviceLabel(lead.service)}
                            </Text>
                          </View>
                          {lead.status === "urgent" ? (
                            <Text style={styles.urgentMark}>🔥</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Добавление точки в уже начатый маршрут */}
      <Modal
        visible={addOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Добавить точку</Text>
            <Text style={styles.modalHint}>
              Новая точка встанет сразу после текущей — заедете по пути, не
              сбивая остальной порядок.
            </Text>

            {lastAdded ? (
              <View style={styles.addedBanner}>
                <Ionicons name="checkmark-circle" size={15} color="#4ade80" />
                <Text style={styles.addedText} numberOfLines={2}>
                  {lastAdded} — следующая точка
                </Text>
              </View>
            ) : null}

            {addCandidates.length === 0 ? (
              <Text style={styles.modalEmpty}>
                Свободных заявок нет: все либо уже в маршруте, либо выполнены.
              </Text>
            ) : (
              <ScrollView
                style={styles.modalBody}
                keyboardShouldPersistTaps="handled"
              >
                {addGroups.map((group) => (
                  <View key={group.city}>
                    <Text style={styles.cityTitle}>{group.city}</Text>
                    {group.leads.map((lead) => (
                      <Pressable
                        key={lead.id}
                        style={({ pressed }) => [
                          styles.pickRow,
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => addStopToRoute(lead)}
                      >
                        <Ionicons
                          name="add-circle-outline"
                          size={21}
                          color={colors.primary}
                        />
                        <View style={styles.stopText}>
                          <Text style={styles.stopAddress} numberOfLines={1}>
                            {lead.address || "адрес не указан"}
                          </Text>
                          <Text style={styles.stopMeta} numberOfLines={1}>
                            {lead.name} · {serviceLabel(lead.service)}
                          </Text>
                        </View>
                        {lead.status === "urgent" ? (
                          <Text style={styles.urgentMark}>🔥</Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.modalButton,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setAddOpen(false)}
            >
              <Text style={styles.modalButtonText}>Готово</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Окно выбора города — если город не понятен из заявки */}
      {picker}

      {/* Карта маршрута: Leaflet и OpenStreetMap во встроенном браузере.
          Сервер считает координаты и линию проезда — ключей не нужно. */}
      {mapOpen ? (
        <MapScreen
          token={token}
          stops={mapStops}
          currentId={currentId}
          onClose={() => setMapOpen(false)}
          onOpenLead={(id) => {
            const lead = byId.get(id);
            if (lead) onOpenLead(lead);
          }}
          onNavigateByAddress={(id) => {
            const lead = byId.get(id);
            if (lead) void openRoute(lead);
          }}
        />
      ) : null}
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 12,
    minWidth: 70,
  },
  backText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  headerAction: {
    minWidth: 70,
    alignItems: "flex-end",
  },
  headerActionText: {
    color: colors.destructive,
    fontSize: 15,
    fontWeight: "700",
  },
  offlineBanner: {
    backgroundColor: "rgba(245,158,11,0.14)",
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  offlineText: {
    color: "#fbbf24",
    fontSize: 12.5,
    fontWeight: "600",
  },
  scroll: {
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  error: {
    color: colors.destructive,
    fontSize: 15,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "800",
  },
  progressCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  progressHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  progressHint: {
    color: colors.textMuted,
    fontSize: 12.5,
    fontWeight: "600",
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.inputBg,
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  currentCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.45)",
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  currentTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  currentNumber: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  currentNumberText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: "800",
  },
  currentTopText: {
    flex: 1,
    gap: 4,
  },
  currentAddress: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 23,
  },
  urgentText: {
    color: "#f87171",
    fontSize: 12.5,
    fontWeight: "700",
  },
  currentName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  currentService: {
    color: colors.textMuted,
    fontSize: 13,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  phoneText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  currentComment: {
    color: colors.textMuted,
    fontSize: 13.5,
    lineHeight: 19,
  },
  partsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  partsText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12.5,
  },
  navRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
  },
  navButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  mapButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  mapButtonText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "700",
  },
  mapPreviewButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
  },
  mapPreviewText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  navButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "800",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
    paddingVertical: 11,
  },
  actionButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  doneButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#15803d",
    paddingVertical: 14,
  },
  doneButtonText: {
    color: "#f0fdf4",
    fontSize: 16,
    fontWeight: "800",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 8,
  },
  // Заголовок раздела рядом с кнопкой действия
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    gap: 10,
  },
  sectionTitleRow: {
    marginTop: 0,
    flexShrink: 1,
  },
  // Кнопка «+ Добавить точку» в рейсе
  addStopButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.5)",
    backgroundColor: "rgba(245,162,11,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addStopText: {
    color: colors.primary,
    fontSize: 12.5,
    fontWeight: "700",
  },
  // Окно добавления точки
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxHeight: "86%",
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    gap: 10,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  modalHint: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  modalBody: {
    flexGrow: 0,
  },
  modalEmpty: {
    color: colors.textMuted,
    fontSize: 13.5,
    lineHeight: 19,
  },
  modalButton: {
    borderRadius: 12,
    backgroundColor: colors.primary,
    paddingVertical: 13,
    alignItems: "center",
  },
  modalButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: "800",
  },
  // Подтверждение: точка добавлена и станет следующей
  addedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.4)",
    backgroundColor: "rgba(34,197,94,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  addedText: {
    flex: 1,
    color: "#4ade80",
    fontSize: 12.5,
    fontWeight: "700",
  },
  cityTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 2,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  stopRowDone: {
    opacity: 0.55,
  },
  stopRowCurrent: {
    borderColor: "rgba(245,162,11,0.55)",
  },
  stopNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
  },
  stopNumberDone: {
    backgroundColor: "rgba(21,128,61,0.25)",
  },
  stopNumberText: {
    color: colors.text,
    fontSize: 12.5,
    fontWeight: "800",
  },
  stopText: {
    flex: 1,
    gap: 2,
  },
  stopAddress: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: "700",
  },
  stopTextDone: {
    textDecorationLine: "line-through",
  },
  stopMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  planCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  planHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 2,
  },
  resortText: {
    color: colors.primary,
    fontSize: 12.5,
    fontWeight: "700",
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 7,
  },
  planNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(245,162,11,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  planNumberText: {
    color: colors.primary,
    fontSize: 12.5,
    fontWeight: "800",
  },
  removeButton: {
    padding: 4,
  },
  orderButtons: {
    flexDirection: "column",
    alignItems: "center",
  },
  orderButton: {
    paddingHorizontal: 2,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  pickRowSelected: {
    borderColor: "rgba(245,162,11,0.55)",
    backgroundColor: "rgba(245,162,11,0.08)",
  },
  urgentMark: {
    fontSize: 14,
  },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
  },
  startButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "800",
  },
  finishCard: {
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    padding: 20,
  },
  finishTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  finishHint: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
});

/**
 * Расходники в машине мастера.
 *
 * Мастер видит, что и сколько лежит в машине, и в один тап списывает
 * («−») или добавляет («+») остаток. Когда остаток падает до заданного
 * минимума, позиция уходит наверх и помечается «Мало» / «Закончилось» —
 * так видно, что пора закупать, не пересчитывая коробки руками.
 *
 * Списание идёт дельтой (как и на сервере), поэтому два телефона не
 * затирают правки друг друга, а офлайн-изменения уходят в общую очередь
 * и применяются при появлении связи.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  api,
  cacheStock,
  formatQty,
  getCachedStock,
  isLowStock,
  isNetworkError,
  isOutOfStock,
  isServerError,
  type StockItem,
  type StockItemInput,
} from "../api";
import {
  flushPending,
  queueStockAdjust,
  queueStockCreate,
  queueStockDelete,
  queueStockUpdate,
  useSyncState,
} from "../sync";
import { EmptyState } from "../components/EmptyState";
import { ListSkeleton } from "../components/Skeletons";
import { colors } from "../theme";

interface Props {
  token: string;
  onBack: () => void;
}

/** Быстрые варианты единицы измерения. */
const UNITS = ["шт", "м", "пара", "кг", "л"];

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** «1,5» → 1.5. Пусто, мусор и отрицательное — 0. */
function parseQty(text: string): number {
  const n = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}

/** Склонение: plural(3, ["позиция", "позиции", "позиций"]) → «позиции». */
function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Порядок такой же, как на сервере: сначала то, что пора закупать,
 * внутри групп — по алфавиту. Локальные правки не переставляют список
 * в другой порядок, чем после перезагрузки.
 */
function sortItems(items: StockItem[]): StockItem[] {
  return [...items].sort((a, b) => {
    const aLow = isLowStock(a);
    const bLow = isLowStock(b);
    if (aLow !== bLow) return aLow ? -1 : 1;
    return a.name.localeCompare(b.name, "ru");
  });
}

export function StockScreen({ token, onBack }: Props) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Модалка добавления/редактирования позиции
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [unitInput, setUnitInput] = useState("шт");
  const [qtyInput, setQtyInput] = useState("");
  const [minInput, setMinInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const { revision } = useSyncState();

  // После отправки очереди перечитываем список: локальные id заменяются
  // на настоящие, остатки приходят с сервера.
  useEffect(() => {
    if (revision > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const load = useCallback(
    async (asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      try {
        const data = await api.stock(token);
        setItems(sortItems(data ?? []));
        setIsOffline(false);
        await cacheStock(data ?? []);
        await flushPending(token);
      } catch {
        // Нет связи — показываем последний сохранённый список
        const cached = await getCachedStock();
        if (cached.length > 0) {
          setItems(sortItems(cached));
          setIsOffline(true);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    (async () => {
      const cached = await getCachedStock();
      if (cached.length > 0) {
        setItems(sortItems(cached));
        setLoading(false);
      }
      load();
    })();
  }, [load]);

  const lowItems = useMemo(() => items.filter(isLowStock), [items]);
  const outItems = useMemo(() => items.filter(isOutOfStock), [items]);

  // --- Быстрое списание / пополнение ---

  const adjust = async (item: StockItem, delta: number) => {
    const next = Math.max(0, item.qty + delta);
    if (next === item.qty) return;
    setItems((prev) =>
      sortItems(prev.map((i) => (i.id === item.id ? { ...i, qty: next } : i))),
    );
    try {
      const updated = await api.adjustStockItem(token, item.id, delta);
      setItems((prev) =>
        sortItems(prev.map((i) => (i.id === item.id ? { ...updated } : i))),
      );
      const cached = await getCachedStock();
      await cacheStock(cached.map((i) => (i.id === item.id ? { ...updated } : i)));
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — правка уйдёт в очередь и применится позже
        await queueStockAdjust(item.id, delta);
        setIsOffline(true);
      } else {
        setItems((prev) =>
          sortItems(prev.map((i) => (i.id === item.id ? { ...item } : i))),
        );
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось изменить остаток",
        );
      }
    }
  };

  // --- Модалка ---

  const openCreate = () => {
    setEditing(null);
    setNameInput("");
    setUnitInput("шт");
    setQtyInput("");
    setMinInput("");
    setNoteInput("");
    setModalOpen(true);
  };

  const openEdit = (item: StockItem) => {
    setEditing(item);
    setNameInput(item.name);
    setUnitInput(item.unit);
    setQtyInput(formatQty(item.qty));
    setMinInput(item.minQty > 0 ? formatQty(item.minQty) : "");
    setNoteInput(item.note);
    setModalOpen(true);
  };

  const save = async () => {
    const name = nameInput.trim();
    if (!name) {
      Alert.alert("Название позиции", "Например: «Панель вызывная ELTIS»");
      return;
    }
    const unit = unitInput.trim() || "шт";
    const qty = parseQty(qtyInput);
    const minQty = parseQty(minInput);
    const note = noteInput.trim();
    const input: StockItemInput = { name, unit, qty, minQty, note };
    setModalOpen(false);

    if (editing) {
      const item = editing;
      setItems((prev) =>
        sortItems(
          prev.map((i) => (i.id === item.id ? { ...i, ...input } : i)),
        ),
      );
      try {
        const updated = await api.updateStockItem(token, item.id, input);
        setItems((prev) =>
          sortItems(prev.map((i) => (i.id === item.id ? { ...updated } : i))),
        );
        const cached = await getCachedStock();
        await cacheStock(cached.map((i) => (i.id === item.id ? { ...updated } : i)));
      } catch (e) {
        if (isNetworkError(e) || isServerError(e)) {
          await queueStockUpdate(item.id, input);
          setIsOffline(true);
        } else {
          setItems((prev) =>
            sortItems(prev.map((i) => (i.id === item.id ? { ...item } : i))),
          );
          Alert.alert(
            "Ошибка",
            e instanceof Error ? e.message : "Не удалось сохранить позицию",
          );
        }
      }
      return;
    }

    const clientId = genId();
    const local: StockItem = {
      id: clientId,
      name,
      unit,
      qty,
      minQty,
      note,
      updatedAt: new Date().toISOString(),
    };
    setItems((prev) => sortItems([...prev, local]));
    try {
      const created = await api.createStockItem(token, input);
      setItems((prev) =>
        sortItems(prev.map((i) => (i.id === clientId ? { ...created } : i))),
      );
      const cached = await getCachedStock();
      await cacheStock(cached.map((i) => (i.id === clientId ? { ...created } : i)));
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        await queueStockCreate(clientId, input, local);
        setIsOffline(true);
      } else {
        setItems((prev) => prev.filter((i) => i.id !== clientId));
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось добавить позицию",
        );
      }
    }
  };

  const remove = (item: StockItem) => {
    Alert.alert(
      "Удалить позицию?",
      `«${item.name}» пропадёт из списка расходников.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            setItems((prev) => prev.filter((i) => i.id !== item.id));
            try {
              await api.deleteStockItem(token, item.id);
              const cached = await getCachedStock();
              await cacheStock(cached.filter((i) => i.id !== item.id));
            } catch (e) {
              if (isNetworkError(e) || isServerError(e)) {
                await queueStockDelete(item.id);
                setIsOffline(true);
              } else {
                setItems((prev) => sortItems([...prev, item]));
                Alert.alert(
                  "Ошибка",
                  e instanceof Error ? e.message : "Не удалось удалить позицию",
                );
              }
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: StockItem }) => {
    const low = isLowStock(item);
    const out = isOutOfStock(item);
    const accent = out ? "#ef4444" : low ? colors.primary : colors.cardBorder;
    return (
      <Pressable
        style={({ pressed }) => [
          styles.card,
          { borderLeftColor: accent, borderLeftWidth: 4 },
          pressed && { opacity: 0.95 },
        ]}
        onPress={() => openEdit(item)}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
          {out ? (
            <View style={[styles.badge, styles.badgeOut]}>
              <Text style={styles.badgeOutText}>Закончилось</Text>
            </View>
          ) : low ? (
            <View style={[styles.badge, styles.badgeLow]}>
              <Text style={styles.badgeLowText}>Мало</Text>
            </View>
          ) : null}
        </View>

        {item.note ? (
          <Text style={styles.cardNote} numberOfLines={2}>
            {item.note}
          </Text>
        ) : null}

        <View style={styles.stepperRow}>
          <Pressable
            style={({ pressed }) => [
              styles.stepButton,
              item.qty <= 0 && styles.stepButtonDisabled,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => adjust(item, -1)}
            disabled={item.qty <= 0}
            hitSlop={6}
          >
            <Ionicons name="remove" size={20} color={colors.text} />
          </Pressable>

          <View style={styles.qtyWrap}>
            <Text style={[styles.qtyValue, out && { color: "#f87171" }]}>
              {formatQty(item.qty)}
            </Text>
            <Text style={styles.qtyUnit}>{item.unit}</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.stepButton, pressed && { opacity: 0.8 }]}
            onPress={() => adjust(item, 1)}
            hitSlop={6}
          >
            <Ionicons name="add" size={20} color={colors.text} />
          </Pressable>

          <View style={styles.stepperSpacer} />

          {item.minQty > 0 ? (
            <Text style={[styles.minText, low && { color: accent }]}>
              минимум {formatQty(item.minQty)} {item.unit}
            </Text>
          ) : (
            <Text style={styles.minText}>без порога</Text>
          )}
        </View>

        <Text style={styles.cardFooter}>обновлено {formatDate(item.updatedAt)}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={8}>
          <Text style={styles.backText}>‹ Назад</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Расходники</Text>
          <Text style={styles.headerSubtitle}>
            {items.length > 0
              ? `${items.length} ${plural(items.length, ["позиция", "позиции", "позиций"])} в машине`
              : "что лежит в машине"}
          </Text>
        </View>
        <Pressable onPress={openCreate} style={styles.addButton} hitSlop={8}>
          <Ionicons name="add" size={24} color={colors.primaryForeground} />
        </Pressable>
      </View>

      {isOffline ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Нет связи — изменения применятся, когда появится сеть
          </Text>
        </View>
      ) : null}

      {outItems.length > 0 ? (
        <View style={[styles.banner, styles.bannerOut]}>
          <Ionicons name="alert-circle" size={18} color="#fca5a5" />
          <Text style={styles.bannerTextOut} numberOfLines={2}>
            Закончилось: {outItems.map((i) => i.name).join(", ")}
          </Text>
        </View>
      ) : lowItems.length > 0 ? (
        <View style={[styles.banner, styles.bannerLow]}>
          <Ionicons name="cart-outline" size={18} color="#fbbf24" />
          <Text style={styles.bannerTextLow} numberOfLines={2}>
            Пора закупать: {lowItems.length}{" "}
            {plural(lowItems.length, ["позиция", "позиции", "позиций"])} на минимуме
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {loading && items.length === 0 ? (
          <ListSkeleton />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load(true)}
                tintColor={colors.primary}
              />
            }
            ListEmptyComponent={
              <EmptyState
                iconName="cube-outline"
                title="Список расходников пуст"
                hint="Добавьте «+» то, что возите в машине: панели, трубки, замки, кабель. Приложение напомнит, когда остаток дойдёт до минимума"
              />
            }
          />
        )}
      </KeyboardAvoidingView>

      {/* Модалка добавления / редактирования позиции */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {editing ? "Позиция расходников" : "Новая позиция"}
            </Text>

            <ScrollView
              style={styles.modalBody}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>Название</Text>
              <TextInput
                style={styles.input}
                placeholder="Панель вызывная ELTIS"
                placeholderTextColor={colors.textMuted}
                value={nameInput}
                onChangeText={setNameInput}
              />

              <Text style={styles.fieldLabel}>Единица</Text>
              <View style={styles.unitRow}>
                {UNITS.map((u) => {
                  const active = unitInput.trim() === u;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => setUnitInput(u)}
                      style={[styles.unitChip, active && styles.unitChipActive]}
                    >
                      <Text
                        style={[
                          styles.unitChipText,
                          active && styles.unitChipTextActive,
                        ]}
                      >
                        {u}
                      </Text>
                    </Pressable>
                  );
                })}
                <TextInput
                  style={[styles.input, styles.unitInput]}
                  placeholder="своя"
                  placeholderTextColor={colors.textMuted}
                  value={UNITS.includes(unitInput.trim()) ? "" : unitInput}
                  onChangeText={setUnitInput}
                />
              </View>

              <View style={styles.qtyRow}>
                <View style={styles.qtyField}>
                  <Text style={styles.fieldLabel}>Сейчас в машине</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    value={qtyInput}
                    onChangeText={setQtyInput}
                  />
                </View>
                <View style={styles.qtyField}>
                  <Text style={styles.fieldLabel}>Минимум</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="не задан"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    value={minInput}
                    onChangeText={setMinInput}
                  />
                </View>
              </View>
              <Text style={styles.fieldHint}>
                Когда остаток дойдёт до минимума, позиция поднимется наверх — это
                значит, что пора закупать
              </Text>

              <Text style={styles.fieldLabel}>Заметка</Text>
              <TextInput
                style={[styles.input, styles.noteInput]}
                placeholder="Например: подходит только к панелям ELTIS-200"
                placeholderTextColor={colors.textMuted}
                value={noteInput}
                onChangeText={setNoteInput}
                multiline
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={save}
              >
                <Text style={styles.modalButtonText}>Сохранить</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonGhost,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setModalOpen(false)}
              >
                <Text style={styles.modalButtonTextGhost}>Отмена</Text>
              </Pressable>
              {editing ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.modalButton,
                    styles.modalButtonDanger,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => {
                    setModalOpen(false);
                    remove(editing);
                  }}
                >
                  <Text style={styles.modalButtonText}>Удалить</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
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
    fontSize: 20,
    fontWeight: "800",
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
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
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  bannerOut: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderBottomColor: "rgba(239,68,68,0.5)",
  },
  bannerLow: {
    backgroundColor: "rgba(245,162,11,0.12)",
    borderBottomColor: "rgba(245,162,11,0.45)",
  },
  bannerTextOut: {
    flex: 1,
    color: "#fca5a5",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  bannerTextLow: {
    flex: 1,
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  list: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    gap: 8,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardName: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  badgeLow: {
    backgroundColor: "rgba(245,162,11,0.14)",
    borderColor: "rgba(245,162,11,0.5)",
  },
  badgeLowText: {
    color: "#fbbf24",
    fontSize: 11,
    fontWeight: "800",
  },
  badgeOut: {
    backgroundColor: "rgba(239,68,68,0.16)",
    borderColor: "rgba(239,68,68,0.55)",
  },
  badgeOutText: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "800",
  },
  cardNote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonDisabled: {
    opacity: 0.35,
  },
  qtyWrap: {
    minWidth: 64,
    alignItems: "center",
  },
  qtyValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  qtyUnit: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  stepperSpacer: {
    flex: 1,
  },
  minText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
  },
  cardFooter: {
    color: colors.textMuted,
    fontSize: 11,
    opacity: 0.75,
  },
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
  modalBody: {
    flexGrow: 0,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  fieldHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
    opacity: 0.85,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  unitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  unitChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  unitChipActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(245,162,11,0.16)",
  },
  unitChipText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  unitChipTextActive: {
    color: colors.primary,
  },
  unitInput: {
    flexGrow: 1,
    minWidth: 70,
  },
  qtyRow: {
    flexDirection: "row",
    gap: 10,
  },
  qtyField: {
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
    flexWrap: "wrap",
  },
  modalButton: {
    flexGrow: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  modalButtonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalButtonDanger: {
    backgroundColor: "rgba(239,68,68,0.16)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.55)",
  },
  modalButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: "800",
  },
  modalButtonTextGhost: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "700",
  },
});

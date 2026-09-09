import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import {
  api,
  cacheNotes,
  getCachedNotes,
  isNetworkError,
  isServerError,
  type Lead,
  type Note,
} from "../api";
import {
  flushPending,
  queueNoteCreate,
  queueNoteDelete,
  queueNoteUpdate,
  useSyncState,
} from "../sync";
import { getMyProfile } from "../profile";
import { EmptyState } from "../components/EmptyState";
import { ListSkeleton } from "../components/Skeletons";
import { colors } from "../theme";

interface Props {
  token: string;
  onBack: () => void;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function NotesScreen({ token, onBack }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [input, setInput] = useState("");
  const [myCity, setMyCity] = useState("Админ");
  // Редактирование заметки (модалка)
  const [editing, setEditing] = useState<Note | null>(null);
  const [editText, setEditText] = useState("");
  // Модалка привязки заметки к заявке
  const [linking, setLinking] = useState<Note | null>(null);

  const { pending: pendingCount, revision } = useSyncState();

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      if (p.city) setMyCity(p.city);
    })();
  }, []);

  // После успешной отправки очереди — перечитываем список,
  // чтобы локальные id созданных офлайн заметок заменились на настоящие.
  useEffect(() => {
    if (revision > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const load = useCallback(
    async (asRefresh = false) => {
      if (asRefresh) setRefreshing(true);
      try {
        // Заметки и заявки грузим вместе: для привязанных заметок
        // показываем, к какой заявке они относятся
        const [data, leadsData] = await Promise.all([
          api.notes(token),
          api.leads(token),
        ]);
        setNotes(data ?? []);
        setLeads(leadsData ?? []);
        setIsOffline(false);
        await cacheNotes(data ?? []);
        await flushPending(token);
      } catch (e) {
        const cached = await getCachedNotes();
        if (cached.length > 0) {
          setNotes(cached);
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
      const cached = await getCachedNotes();
      if (cached.length > 0) {
        setNotes(cached);
        setLoading(false);
      }
      load();
    })();
  }, [load]);

  const addNote = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    const now = new Date().toISOString();
    const clientId = genId();
    const local: Note = {
      id: clientId,
      text,
      author: myCity,
      done: "0",
      createdAt: now,
      updatedAt: now,
      leadId: null,
    };
    // Оптимистично добавляем сразу
    setNotes((prev) => [local, ...prev]);
    try {
      const created = await api.createNote(token, text, myCity);
      setNotes((prev) =>
        prev.map((n) => (n.id === clientId ? { ...created } : n)),
      );
      // Обновляем кеш: локальный id заменяем на настоящий
      const cached = await getCachedNotes();
      await cacheNotes(
        cached.map((n) => (n.id === clientId ? { ...created } : n)),
      );
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — заметка уйдёт в очередь
        await queueNoteCreate(clientId, { text, author: myCity }, local);
        setIsOffline(true);
      } else {
        setNotes((prev) => prev.filter((n) => n.id !== clientId));
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось создать заметку",
        );
      }
    }
  };

  const toggleDone = async (note: Note) => {
    const next = note.done === "1" ? "0" : "1";
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, done: next } : n)),
    );
    try {
      await api.updateNote(token, note.id, { done: next });
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        await queueNoteUpdate(note.id, { done: next });
        setIsOffline(true);
      } else {
        setNotes((prev) =>
          prev.map((n) => (n.id === note.id ? { ...n, done: note.done } : n)),
        );
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось обновить заметку",
        );
      }
    }
  };

  const saveEdit = async () => {
    const text = editText.trim();
    if (!text || !editing) return;
    const note = editing;
    setEditing(null);
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, text } : n)),
    );
    try {
      await api.updateNote(token, note.id, { text });
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        await queueNoteUpdate(note.id, { text });
        setIsOffline(true);
      } else {
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось сохранить заметку",
        );
      }
    }
  };

  /** Привязать заметку к заявке (или отвязать, leadId = null). */
  const setNoteLead = async (note: Note, leadId: string | null) => {
    setLinking(null);
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, leadId } : n)),
    );
    try {
      await api.updateNote(token, note.id, { leadId });
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — привязка уйдёт в офлайн-очередь
        await queueNoteUpdate(note.id, { leadId });
        setIsOffline(true);
      } else {
        setNotes((prev) =>
          prev.map((n) => (n.id === note.id ? { ...n, leadId: note.leadId } : n)),
        );
        Alert.alert(
          "Ошибка",
          e instanceof Error ? e.message : "Не удалось привязать заметку",
        );
      }
    }
  };

  /** Активные заявки (без архива) для выбора при привязке. */
  const activeLeads = leads.filter((l) => l.archived !== "1");

  const confirmDelete = (note: Note) => {
    Alert.alert("Удалить заметку?", note.text, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          setNotes((prev) => prev.filter((n) => n.id !== note.id));
          setEditing(null);
          try {
            await api.deleteNote(token, note.id);
          } catch (e) {
            if (isNetworkError(e) || isServerError(e)) {
              await queueNoteDelete(note.id);
              setIsOffline(true);
            } else {
              Alert.alert(
                "Ошибка",
                e instanceof Error ? e.message : "Не удалось удалить",
              );
            }
          }
        },
      },
    ]);
  };

  const renderNote = ({ item }: { item: Note }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Pressable
          onPress={() => toggleDone(item)}
          hitSlop={8}
          style={[styles.checkbox, item.done === "1" && styles.checkboxDone]}
        >
          <Text
            style={[
              styles.checkboxText,
              item.done === "1" && styles.checkboxTextDone,
            ]}
          >
            {item.done === "1" ? "✓" : ""}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.pinButton,
            item.leadId && styles.pinButtonActive,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() => setLinking(item)}
          hitSlop={8}
        >
          <Text
            style={[
              styles.pinButtonText,
              item.leadId && styles.pinButtonTextActive,
            ]}
          >
            {item.leadId ? "📌 Изменить" : "📌 Привязать"}
          </Text>
        </Pressable>
        <Pressable
          style={styles.cardBody}
          onPress={() => {
            setEditing(item);
            setEditText(item.text);
          }}
          onLongPress={() => confirmDelete(item)}
          delayLongPress={500}
        >
          <Text
            style={[styles.cardText, item.done === "1" && styles.cardTextDone]}
            numberOfLines={6}
          >
            {item.text}
          </Text>
          {item.leadId ? (
            <Text style={styles.cardLead} numberOfLines={1}>
              📌 к заявке:{" "}
              {leads.find((l) => l.id === item.leadId)?.name ??
                "заявка удалена"}
            </Text>
          ) : null}
          <Text style={styles.cardMeta}>
            {item.author} · {formatDate(item.createdAt)}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backText}>← Назад</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Заметки</Text>
        <View style={styles.headerSpacer} />
      </View>

      {(isOffline || pendingCount > 0) && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            📡 Офлайн-режим
            {pendingCount > 0
              ? ` · ${pendingCount} измен. ждут отправки`
              : ""}
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Новая заметка…"
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={addNote}
            returnKeyType="done"
            multiline
          />
          <Pressable
            style={({ pressed }) => [
              styles.addButton,
              pressed && { opacity: 0.85 },
            ]}
            onPress={addNote}
          >
            <Text style={styles.addButtonText}>+</Text>
          </Pressable>
        </View>

        {loading && notes.length === 0 ? (
          <ListSkeleton />
        ) : (
          <FlatList
            data={notes}
            keyExtractor={(item) => item.id}
            renderItem={renderNote}
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
                iconName="document-text-outline"
                title="Заметок пока нет"
                hint="Запишите сюда, что нужно не забыть — например, что взять с собой на заявку"
              />
            }
          />
        )}
      </KeyboardAvoidingView>

      {/* Модалка привязки к заявке */}
      <Modal
        visible={linking !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLinking(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Привязать к заявке
            </Text>
            <Text style={styles.modalHint}>
              {linking ? `«${linking.text.slice(0, 40)}${linking.text.length > 40 ? "…" : ""}»` : ""}
            </Text>
            {activeLeads.length === 0 ? (
              <Text style={styles.empty}>Активных заявок нет</Text>
            ) : (
              <ScrollView style={styles.linkList}>
                {activeLeads.map((l) => {
                  const active = linking?.leadId === l.id;
                  return (
                    <Pressable
                      key={l.id}
                      style={[
                        styles.linkRow,
                        active && styles.linkRowActive,
                      ]}
                      onPress={() => linking && setNoteLead(linking, l.id)}
                    >
                      <Text
                        style={[
                          styles.linkRowName,
                          active && styles.linkRowNameActive,
                        ]}
                        numberOfLines={1}
                      >
                        {active ? "✓ " : ""}
                        {l.name}
                      </Text>
                      <Text style={styles.linkRowAddr} numberOfLines={1}>
                        📍 {l.address}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              {linking?.leadId ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.modalButton,
                    styles.modalButtonDanger,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={() => linking && setNoteLead(linking, null)}
                >
                  <Text style={styles.modalButtonText}>Отвязать</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonGhost,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setLinking(null)}
              >
                <Text style={styles.modalButtonTextGhost}>Закрыть</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Модалка редактирования */}
      <Modal
        visible={editing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Редактировать заметку</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Текст заметки"
              placeholderTextColor={colors.textMuted}
              value={editText}
              onChangeText={setEditText}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={saveEdit}
              >
                <Text style={styles.modalButtonText}>Сохранить</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalButtonGhost,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setEditing(null)}
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
                  onPress={() => confirmDelete(editing)}
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
  },
  backText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
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
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
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
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonText: {
    color: colors.primaryForeground,
    fontSize: 22,
    fontWeight: "800",
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
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    backgroundColor: colors.inputBg,
  },
  checkboxDone: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(34,197,94,0.2)",
  },
  checkboxText: {
    color: "#4ade80",
    fontSize: 15,
    fontWeight: "800",
  },
  checkboxTextDone: {
    color: "#22c55e",
  },
  pinButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: colors.inputBg,
    marginTop: 1,
  },
  pinButtonActive: {
    borderColor: "#f5a20b",
    backgroundColor: "rgba(245,162,11,0.12)",
  },
  pinButtonText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  pinButtonTextActive: {
    color: "#f5a20b",
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
  },
  cardTextDone: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  cardLead: {
    color: "#f5a20b",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
    flex: 1,
  },
  cardMeta: {
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
  empty: {
    color: colors.textMuted,
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  modalHint: {
    color: colors.textMuted,
    fontSize: 13,
  },
  linkList: {
    maxHeight: 300,
    gap: 8,
  },
  linkRow: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  linkRowActive: {
    borderColor: "#f5a20b",
    backgroundColor: "rgba(245,162,11,0.12)",
  },
  linkRowName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  linkRowNameActive: {
    color: "#f5a20b",
  },
  linkRowAddr: {
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  modalInput: {
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
    textAlignVertical: "top",
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  modalButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  modalButtonGhost: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalButtonDanger: {
    backgroundColor: colors.destructive,
  },
  modalButtonText: {
    color: colors.primaryForeground,
    fontWeight: "700",
    fontSize: 14,
  },
  modalButtonTextGhost: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 14,
  },
});
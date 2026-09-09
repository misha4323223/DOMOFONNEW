import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  api,
  SERVICES,
  LEAD_STATUSES,
  cacheNotes,
  getCachedNotes,
  isNetworkError,
  isServerError,
  type Lead,
  type LeadInput,
  type LeadStatus,
  type Note,
} from "../api";
import { queueLeadCreate, queueLeadUpdate } from "../sync";
import { colors } from "../theme";

interface Props {
  token: string;
  lead: Lead | null; // null — создание новой заявки
  onSaved: () => void;
  onBack: () => void;
}

export function LeadFormScreen({ token, lead, onSaved, onBack }: Props) {
  const [name, setName] = useState(lead?.name ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [service, setService] = useState(lead?.service ?? "install");
  const [address, setAddress] = useState(lead?.address ?? "");
  const [comment, setComment] = useState(lead?.comment ?? "");
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? "new");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Заметки, привязанные к заявке (просмотр; привязывают во вкладке «Заметки»)
  const [leadNotes, setLeadNotes] = useState<Note[]>([]);

  // Подгружаем привязанные заметки при открытии формы редактирования
  useEffect(() => {
    if (!lead) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.notes(token);
        if (!cancelled) {
          setLeadNotes(
            (data ?? []).filter((n) => n.leadId === lead.id),
          );
        }
        await cacheNotes(data ?? []);
      } catch {
        const cached = await getCachedNotes();
        if (!cancelled) {
          setLeadNotes(cached.filter((n) => n.leadId === lead.id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lead, token]);

  const save = async () => {
    if (!name.trim() || !phone.trim() || !address.trim()) {
      setError(isCityField ? "Заполните город, телефон и адрес" : "Заполните имя, телефон и адрес");
      return;
    }
    setBusy(true);
    setError(null);
    const body: LeadInput = {
      name: name.trim(),
      phone: phone.trim(),
      service,
      address: address.trim(),
      comment: comment.trim() || null,
    };
    try {
      if (lead) {
        await api.updateLead(token, lead.id, { ...body, status });
      } else {
        await api.createLead(token, body);
      }
      onSaved();
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Нет связи — сохраняем офлайн: изменение отправится само,
        // когда интернет появится.
        if (lead) {
          await queueLeadUpdate(lead.id, { ...body, status });
        } else {
          const clientId = `local-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          const full: Lead = {
            id: clientId,
            ...body,
            status: "new",
            source: "admin",
            createdAt: new Date().toISOString(),
          };
          await queueLeadCreate(clientId, body, full);
        }
        onSaved();
      } else {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    } finally {
      setBusy(false);
    }
  };

  // Заявка, созданная вручную (админ), вместо имени клиента хранит город.
  // Новая заявка всегда ручная; клиентские заявки с сайта — по полю source.
  const isCityField = !lead || lead.source === "admin";

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={12}>
            <Text style={styles.back}>← Назад</Text>
          </Pressable>
          <Text style={styles.headerTitle}>
            {lead ? "Редактировать заявку" : "Новая заявка"}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
        <Text style={styles.label}>{isCityField ? "Город" : "Имя"}</Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={[styles.input, styles.inputFlex]}
            value={name}
            onChangeText={setName}
            placeholder={isCityField ? "Например: Богородицк" : "Как зовут клиента"}
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <Text style={styles.label}>Телефон</Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={[styles.input, styles.inputFlex]}
            value={phone}
            onChangeText={setPhone}
            placeholder="+7 ___ ___-__-__"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          />
        </View>

        <Text style={styles.label}>Услуга</Text>
        <View style={styles.services}>
          {SERVICES.map((s) => {
            const active = s.value === service;
            return (
              <Pressable
                key={s.value}
                style={[styles.serviceChip, active && styles.serviceChipActive]}
                onPress={() => setService(s.value)}
              >
                <Text
                  style={[
                    styles.serviceChipText,
                    active && styles.serviceChipTextActive,
                  ]}
                >
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Адрес</Text>
        <View style={styles.fieldRow}>
          <TextInput
            style={[styles.input, styles.inputFlex]}
            value={address}
            onChangeText={setAddress}
            placeholder="г. Тула, ул. ..."
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <Text style={styles.label}>Комментарий</Text>
        <View style={styles.fieldRow}>
          <TextInput              style={[
                styles.input,
                styles.multiline,
                styles.inputFlex,
              ]}
            value={comment}
            onChangeText={setComment}
            placeholder="Детали заявки (необязательно)"
            placeholderTextColor={colors.textMuted}
            multiline
          />
        </View>

        {lead ? (
          <>
            <Text style={styles.label}>Статус</Text>
            <View style={styles.services}>
              {LEAD_STATUSES.map((s) => {
                const active = status === s.value;
                return (
                  <Pressable
                    key={s.value}
                    style={[
                      styles.serviceChip,
                      active && styles.serviceChipActive,
                    ]}
                    onPress={() => setStatus(s.value)}
                  >
                    <Text
                      style={[
                        styles.serviceChipText,
                        active && styles.serviceChipTextActive,
                      ]}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {lead && leadNotes.length > 0 ? (
          <>
            <Text style={styles.label}>📌 Привязанные заметки</Text>
            {leadNotes.map((n) => (
              <View key={n.id} style={styles.noteRow}>
                <Text
                  style={[
                    styles.noteText,
                    n.done === "1" && styles.noteTextDone,
                  ]}
                >
                  {n.text}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && { opacity: 0.85 },
          ]}
          onPress={save}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={styles.buttonText}>Сохранить</Text>
          )}
        </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  kav: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  back: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "600",
    minWidth: 60,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  content: {
    padding: 20,
    gap: 8,
    paddingBottom: 40,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 6,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  noteRow: {
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  noteText: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
  },
  noteTextDone: {
    textDecorationLine: "line-through",
    color: colors.textMuted,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  inputFlex: {
    flex: 1,
  },
  services: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  serviceChip: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.inputBg,
  },
  serviceChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  serviceChipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  serviceChipTextActive: {
    color: colors.primaryForeground,
  },
  error: {
    color: colors.destructive,
    fontSize: 14,
    marginTop: 8,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 16,
  },
  buttonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "700",
  },
});

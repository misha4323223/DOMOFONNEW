import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  api,
  SERVICES,
  isNetworkError,
  isServerError,
  type Lead,
  type LeadCandidate,
  type LeadInput,
} from "../api";
import { queueLeadCreate } from "../sync";
import { colors } from "../theme";

interface Props {
  token: string;
  candidates: LeadCandidate[];
  fullText: string;
  onDone: () => void;
  onBack: () => void;
}

interface Editable extends LeadCandidate {
  include: boolean;
}

export function ReviewScreen({ token, candidates, fullText, onDone, onBack }: Props) {
  const [items, setItems] = useState<Editable[]>(
    candidates.map((c) => ({ ...c, include: true })),
  );
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const update = (index: number, patch: Partial<Editable>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const createAll = async () => {
    const selected = items.filter((it) => it.include);
    if (selected.length === 0) return;
    setBusy(true);
    let createdOnline = 0;
    let queued = 0;
    try {
      for (const it of selected) {
        const body: LeadInput = {
          name: it.name.trim() || "Без имени",
          phone: it.phone.trim(),
          service: it.service ?? "consult",
          address: it.address.trim(),
          comment: it.comment.trim() || null,
        };
        try {
          await api.createLead(token, body);
          createdOnline++;
        } catch (e) {
          if (isNetworkError(e) || isServerError(e)) {
            // Нет связи — заявки кладём в очередь, отправятся автоматически
            const clientId = `local-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`;
            const full: Lead = {
              id: clientId,
              ...body,
              status: "new",
              createdAt: new Date().toISOString(),
            };
            await queueLeadCreate(clientId, body, full);
            queued++;
          } else {
            throw e;
          }
        }
      }
      if (queued > 0) {
        Alert.alert(
          "Готово",
          `Создано заявок: ${createdOnline}, в очереди: ${queued} — отправятся при появлении интернета`,
        );
      } else {
        Alert.alert("Готово", `Создано заявок: ${createdOnline}`);
      }
      onDone();
    } catch (e) {
      Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось создать заявки");
    } finally {
      setBusy(false);
    }
  };

  const renderCard = ({ item, index }: { item: Editable; index: number }) => (
    <View style={[styles.card, !item.include && styles.cardDisabled]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIndex}>{index + 1}</Text>
        <Pressable
          style={[styles.check, item.include && styles.checkOn]}
          onPress={() => update(index, { include: !item.include })}
          hitSlop={10}
        >
          <Text style={[styles.checkText, item.include && styles.checkTextOn]}>
            {item.include ? "✓" : ""}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Имя</Text>
      <TextInput
        style={styles.input}
        value={item.name}
        onChangeText={(v) => update(index, { name: v })}
        placeholder="Имя клиента"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>Телефон</Text>
      {item.phone.trim() === "" ? (
        <View style={styles.noPhoneBadge}>
          <Text style={styles.noPhoneBadgeText}>⚠ Без телефона — номер не распознан, впишите вручную</Text>
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        value={item.phone}
        onChangeText={(v) => update(index, { phone: v })}
        placeholder={item.phone.trim() === "" ? "Номер не распознан — впишите вручную" : "+7 ___ ___-__-__"}
        placeholderTextColor={colors.textMuted}
        keyboardType="phone-pad"
      />

      <Text style={styles.label}>Адрес</Text>
      <TextInput
        style={styles.input}
        value={item.address}
        onChangeText={(v) => update(index, { address: v })}
        placeholder="г. ___, ул. ___"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>Услуга</Text>
      <View style={styles.services}>
        {SERVICES.map((s) => {
          const active = (item.service ?? "consult") === s.value;
          return (
            <Pressable
              key={s.value}
              style={[styles.serviceChip, active && styles.serviceChipActive]}
              onPress={() => update(index, { service: s.value })}
            >
              <Text style={[styles.serviceChipText, active && styles.serviceChipTextActive]}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Комментарий</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={item.comment}
        onChangeText={(v) => update(index, { comment: v })}
        placeholder="Детали (необязательно)"
        placeholderTextColor={colors.textMuted}
        multiline
      />

      <Text style={styles.raw}>Распознано: {item.raw}</Text>
    </View>
  );

  const selectedCount = items.filter((it) => it.include).length;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>← Назад</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Проверьте заявки</Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderCard}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.summary}>
            <Text style={styles.summaryText}>
              Распознано строк: {candidates.length}. Проверьте поля и нажмите «Создать».
            </Text>
            <Pressable onPress={() => setShowRaw((v) => !v)} hitSlop={8}>
              <Text style={styles.rawToggle}>{showRaw ? "Скрыть" : "Показать"} сырой текст</Text>
            </Pressable>
            {showRaw && fullText ? <Text style={styles.rawBlock}>{fullText}</Text> : null}
          </View>
        }
      />

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [
            styles.createButton,
            (busy || selectedCount === 0) && { opacity: 0.6 },
            pressed && { opacity: 0.85 },
          ]}
          onPress={createAll}
          disabled={busy || selectedCount === 0}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={styles.createButtonText}>
              Создать заявки ({selectedCount})
            </Text>
          )}
        </Pressable>
      </View>
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
  list: {
    padding: 16,
    gap: 12,
    paddingBottom: 24,
  },
  summary: {
    gap: 6,
    marginBottom: 4,
  },
  summaryText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  rawToggle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  rawBlock: {
    color: colors.textMuted,
    fontSize: 12,
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    padding: 10,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 14,
    gap: 6,
  },
  cardDisabled: {
    opacity: 0.45,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  cardIndex: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  checkTextOn: {
    color: colors.primaryForeground,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  noPhoneBadge: {
    backgroundColor: "rgba(239,68,68,0.12)",
    borderColor: "#ef4444",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  noPhoneBadgeText: {
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "600",
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: {
    minHeight: 60,
    textAlignVertical: "top",
  },
  services: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  serviceChip: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.inputBg,
  },
  serviceChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  serviceChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  serviceChipTextActive: {
    color: colors.primaryForeground,
  },
  raw: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    fontStyle: "italic",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  createButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "700",
  },
});
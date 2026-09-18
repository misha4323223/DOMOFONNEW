import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import {
  api,
  SERVICES,
  LEAD_STATUSES,
  cacheNotes,
  cacheStock,
  formatQty,
  getCachedNotes,
  getCachedStock,
  isNetworkError,
  isServerError,
  serviceLabel,
  type Lead,
  type LeadInput,
  type LeadPart,
  type LeadStatus,
  type Note,
  type StockItem,
} from "../api";
import { queueLeadCreate, queueLeadUpdate } from "../sync";
import { colors } from "../theme";
import { CRITICAL_DAYS, STALE_DAYS, staleInfo } from "../leadAge";
import { useRouteCity } from "../components/CityPicker";
import { callPhone } from "../phone";
import { ordinalLabel, type WithRepeat } from "../repeats";

/** Дата в коротком виде: «12.05.2026» — для строки о прошлом обращении. */
function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

interface Props {
  token: string;
  /** null — создание новой заявки. У повторной заявки есть история обращений. */
  lead: WithRepeat<Lead> | null;
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

  // --- Расходники, израсходованные на заявке ---
  // Прикрепляем позиции из «Расходников»; когда заявку закрывают, сервер
  // списывает их с остатка (см. server/routes.ts).
  const [parts, setParts] = useState<LeadPart[]>(lead?.parts ?? []);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [partsPicker, setPartsPicker] = useState(false);

  /** Добавить позицию к заявке (или +1, если она уже прикреплена). */
  const addPart = (item: StockItem): void => {
    setParts((prev) => {
      const found = prev.find((p) => p.stockId === item.id);
      if (found) {
        return prev.map((p) =>
          p.stockId === item.id ? { ...p, qty: p.qty + 1 } : p,
        );
      }
      return [
        ...prev,
        { stockId: item.id, name: item.name, unit: item.unit, qty: 1 },
      ];
    });
  };

  /** Изменить количество; ноль и меньше — убрать позицию. */
  const setPartQty = (stockId: string, qty: number): void => {
    setParts((prev) =>
      qty <= 0
        ? prev.filter((p) => p.stockId !== stockId)
        : prev.map((p) => (p.stockId === stockId ? { ...p, qty } : p)),
    );
  };

  const removePart = (stockId: string): void => {
    setParts((prev) => prev.filter((p) => p.stockId !== stockId));
  };

  /** Остаток позиции в машине (чтобы видеть, хватает ли). */
  const stockQtyOf = (stockId: string): number | null => {
    const item = stock.find((i) => i.id === stockId);
    return item ? item.qty : null;
  };

  // --- Голосовой ввод: диктуем фразу, поля заполняются сами ---
  const [dictating, setDictating] = useState(false);
  const [dictationText, setDictationText] = useState("");
  const [dictationBusy, setDictationBusy] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  // Готовые (финальные) куски речи и текущий недописанный хвост
  const finalSpeechRef = useRef("");
  const interimSpeechRef = useRef("");
  const parseOnEndRef = useRef(false);

  /** Разобрать распознанный текст на сервере и разложить по полям. */
  const fillFromDictation = async (spoken: string): Promise<void> => {
    const text = spoken.replace(/\s+/g, " ").trim();
    if (!text) {
      setDictationError("Ничего не расслышали — попробуйте ещё раз");
      return;
    }
    setDictationText(text);
    setDictationBusy(true);
    setDictationError(null);
    try {
      const { fields } = await api.parseDictation(token, text);
      if (fields.name) setName(fields.name);
      if (fields.phone) setPhone(fields.phone);
      if (fields.address) setAddress(fields.address);
      if (fields.comment) setComment(fields.comment);
      if (fields.service) setService(fields.service);
    } catch {
      // Сервер недоступен — диктовку не теряем, кладём её в комментарий
      setComment((prev) => (prev ? `${prev}\n${text}` : text));
      setDictationError("Сервер недоступен — текст добавлен в комментарий");
    } finally {
      setDictationBusy(false);
    }
  };

  useSpeechRecognitionEvent("start", () => {
    setDictating(true);
    setDictationError(null);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const best = event.results?.[0]?.transcript?.trim() ?? "";
    if (!best) return;
    if (event.isFinal) {
      // Речь распознаётся кусками (segments) — собираем их подряд
      finalSpeechRef.current = finalSpeechRef.current
        ? `${finalSpeechRef.current} ${best}`
        : best;
      interimSpeechRef.current = "";
    } else {
      interimSpeechRef.current = best;
    }
    setDictationText(
      `${finalSpeechRef.current} ${interimSpeechRef.current}`.trim(),
    );
  });

  useSpeechRecognitionEvent("error", (event) => {
    const messages: Record<string, string> = {
      "not-allowed": "Разрешите доступ к микрофону в настройках приложения",
      "no-speech": "Речь не расслышали — попробуйте ещё раз",
      network: "Для распознавания речи нужен интернет",
      "service-not-allowed": "На этом устройстве нет распознавания русской речи",
      busy: "Микрофон занят другим приложением",
      aborted: "",
    };
    const text = messages[event.error] ?? event.message ?? "Не удалось распознать речь";
    if (text) setDictationError(text);
  });

  useSpeechRecognitionEvent("end", () => {
    setDictating(false);
    if (!parseOnEndRef.current) return;
    parseOnEndRef.current = false;
    const spoken = `${finalSpeechRef.current} ${interimSpeechRef.current}`;
    void fillFromDictation(spoken);
  });

  // Уходим с экрана — выключаем микрофон
  useEffect(
    () => () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // микрофон уже выключен — это нормально
      }
    },
    [],
  );

  const startDictation = async (): Promise<void> => {
    setDictationError(null);
    finalSpeechRef.current = "";
    interimSpeechRef.current = "";
    setDictationText("");
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setDictationError("Нужно разрешить доступ к микрофону");
        return;
      }
      parseOnEndRef.current = true;
      ExpoSpeechRecognitionModule.start({
        lang: "ru-RU",
        interimResults: true,
        // Долгая диктовка: распознаём, пока не остановим сами
        continuous: true,
        maxAlternatives: 1,
        addsPunctuation: true,
        // Подсказки распознавателю — наши частые слова и названия
        contextualStrings: [
          "домофон",
          "трубка",
          "доводчик",
          "вызов",
          "квартира",
          "подъезд",
          "улица",
          "домофонная служба",
          "не работает",
          "установить",
        ],
      });
    } catch {
      parseOnEndRef.current = false;
      setDictationError("Не удалось включить микрофон");
    }
  };

  const stopDictation = (): void => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setDictating(false);
    }
  };

  // Подгружаем привязанные заметки и расходники при открытии формы.
  // Список расходников нужен и для новой заявки: их можно прикрепить сразу,
  // не сохраняя заявку и не открывая её заново.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (lead) {
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
      }

      // Расходники: без сети берём последний сохранённый список
      try {
        const items = await api.stock(token);
        if (!cancelled) setStock(items ?? []);
        await cacheStock(items ?? []);
      } catch {
        const cached = await getCachedStock();
        if (!cancelled) setStock(cached);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lead, token]);

  /**
   * Кнопка «Сохранить».
   *
   * Телефон не обязателен: заявку можно завести без номера (клиент подошёл
   * лично или номер узнаем позже). Но без него позвонить из заявки нельзя,
   * поэтому сначала предупреждаем — и, если подтвердили, сохраняем.
   */
  const save = () => {
    if (!name.trim() || !address.trim()) {
      setError(isCityField ? "Заполните город и адрес" : "Заполните имя и адрес");
      return;
    }
    if (!phone.trim()) {
      Alert.alert(
        "Заявка без телефона",
        "Номер не указан: позвонить клиенту из заявки не получится, а повторные " +
          "обращения будем искать по адресу. Сохранить так?",
        [
          { text: "Вернуться", style: "cancel" },
          { text: "Сохранить без телефона", onPress: () => void saveLead() },
        ],
      );
      return;
    }
    void saveLead();
  };

  const saveLead = async () => {
    setBusy(true);
    setError(null);
    const body: LeadInput = {
      name: name.trim(),
      phone: phone.trim(),
      service,
      address: address.trim(),
      comment: comment.trim() || null,
      // Расходники уезжают на сервер сразу при создании заявки: списание
      // произойдёт в момент, когда заявку переведут в «Выполнена».
      parts,
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
        // когда интернет появится. Расходники спишутся на сервере
        // в момент, когда до него дойдёт перевод заявки в «Выполнена».
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
            archived: "0",
            // Списывает сервер — в момент, когда заявку закроют
            partsDone: "0",
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

  // Заявка висит больше недели — предупреждаем прямо в форме
  const stale = lead ? staleInfo(lead) : null;

  // Маршрут до адреса: если город не понятен — спросим (окно picker)
  const { openRoute, picker } = useRouteCity();

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
        {/* Предупреждение: заявка висит больше недели */}
        {stale ? (
          <View
            style={[
              styles.staleCard,
              stale.level === "critical" && styles.staleCardCritical,
            ]}
          >
            <Ionicons
              name={stale.level === "critical" ? "alert-circle" : "time-outline"}
              size={17}
              color={stale.level === "critical" ? "#f87171" : "#fbbf24"}
            />
            <Text
              style={[
                styles.staleCardText,
                stale.level === "critical" && styles.staleCardTextCritical,
              ]}
            >
              Заявка {stale.text}.{" "}
              {stale.level === "critical"
                ? `Клиент ждёт больше ${CRITICAL_DAYS} дней — свяжитесь с ним сегодня.`
                : `Пора связаться с клиентом (порог — ${STALE_DAYS} дней).`}
            </Text>
          </View>
        ) : null}

        {/* Голосовой ввод: надиктовали фразу — поля заполнились сами */}
        <View style={styles.dictationCard}>
          <Pressable
            style={({ pressed }) => [
              styles.dictationButton,
              dictating && styles.dictationButtonActive,
              dictationBusy && { opacity: 0.6 },
              pressed && { opacity: 0.85 },
            ]}
            onPress={dictating ? stopDictation : startDictation}
            disabled={dictationBusy}
          >
            {dictationBusy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Ionicons
                name={dictating ? "stop-circle" : "mic"}
                size={22}
                color={dictating ? colors.text : colors.primaryForeground}
              />
            )}
            <Text
              style={[
                styles.dictationButtonText,
                dictating && styles.dictationButtonTextActive,
              ]}
            >
              {dictating ? "Остановить" : "🎤 Надиктовать заявку"}
            </Text>
          </Pressable>

          {dictating ? (
            <Text style={styles.dictationLive}>
              {dictationText ||
                "Говорите: имя, телефон, город, адрес, что случилось"}
            </Text>
          ) : dictationText ? (
            <Text style={styles.dictationHint}>
              Распознано: {dictationText}
            </Text>
          ) : (
            <Text style={styles.dictationHint}>
              Одна фраза: «Иванов Иван, 8 905 113 29 62, Ефремов, улица Мира дом 5,
              не работает трубка»
            </Text>
          )}

          {dictationError ? (
            <Text style={styles.error}>{dictationError}</Text>
          ) : null}
        </View>

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
          {/* Позвонить можно сразу из формы, не выходя в список */}
          {phone.trim() ? (
            <Pressable
              style={({ pressed }) => [
                styles.callButton,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => callPhone(phone)}
              hitSlop={4}
            >
              <Ionicons name="call" size={18} color="#4ade80" />
            </Pressable>
          ) : null}
        </View>
        {/* Телефон не обязателен — предупреждаем, но сохранить не мешаем */}
        {!phone.trim() ? (
          <Text style={styles.phoneWarning}>
            ⚠ Без телефона: позвонить клиенту не получится, повторные обращения
            найдём по адресу
          </Text>
        ) : null}

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

        {/* Повторное обращение: одна строка, без дополнительных блоков */}
        {lead?.repeatInfo && lead.repeatInfo.order > 1 ? (
          <View style={styles.repeatRow}>
            <Text style={styles.repeatText}>
              {lead.repeatInfo.byPhone && lead.repeatInfo.byAddress
                ? "🔁"
                : lead.repeatInfo.byAddress
                  ? "🏠"
                  : "🔁"}{" "}
              {ordinalLabel(lead.repeatInfo.order)} обращение
              {lead.repeatInfo.previous
                ? ` · прошлый раз: ${formatShortDate(lead.repeatInfo.previous.createdAt)} · ${serviceLabel(
                    lead.repeatInfo.previous.service,
                  )}`
                : ""}
            </Text>
          </View>
        ) : null}

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
        {/* Проверить адрес до выезда: тап — открывается навигатор */}
        {address.trim() ? (
          <Pressable
            style={({ pressed }) => [
              styles.routeRow,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() =>
              // У ручных заявок в поле «Город» лежит название города
              openRoute({
                name: isCityField ? name : "",
                address,
                source: isCityField ? "admin" : "site",
              })
            }
            hitSlop={4}
          >
            <Ionicons name="navigate" size={14} color={colors.text} />
            <Text style={styles.routeRowText}>
              Открыть адрес в навигаторе
            </Text>
          </Pressable>
        ) : null}

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

        {/* Расходники, ушедшие на эту заявку: списываются при выполнении.
            Блок есть и у новой заявки — прикрепить расходник можно сразу,
            не сохраняя заявку и не открывая её потом заново. */}
        <Text style={styles.label}>🧰 Израсходовано на заявке</Text>

        {parts.length === 0 ? (
          <Text style={styles.partsHint}>
            {lead
              ? "Пока ничего не прикреплено. Добавьте панель, трубку, замок — при сохранении выполненной заявки они спишутся с остатка в машине."
              : "Ничего не прикреплено. Если на этой работе уже что-то израсходовали — добавьте позицию сейчас: остаток спишется, когда заявку закроют."}
          </Text>
        ) : null}

        {parts.map((p) => {
          const left = stockQtyOf(p.stockId);
          const short = left !== null && p.qty > left;
          return (
            <View key={p.stockId} style={styles.partRow}>
              <View style={styles.partInfo}>
                <Text style={styles.partName} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={[styles.partStock, short && styles.partStockShort]}>
                  {left === null
                    ? "нет в расходниках"
                    : short
                      ? `в машине только ${formatQty(left)} ${p.unit}`
                      : `в машине ${formatQty(left)} ${p.unit}`}
                </Text>
              </View>

              {/* Количество: − / + и значение (шаг 1) */}
              <View style={styles.partStepper}>
                <Pressable
                  style={styles.partStepButton}
                  onPress={() =>
                    setPartQty(p.stockId, Math.round((p.qty - 1) * 1000) / 1000)
                  }
                  hitSlop={6}
                >
                  <Ionicons name="remove" size={15} color={colors.text} />
                </Pressable>
                <Text style={styles.partQty}>
                  {formatQty(p.qty)} {p.unit}
                </Text>
                <Pressable
                  style={styles.partStepButton}
                  onPress={() => setPartQty(p.stockId, p.qty + 1)}
                  hitSlop={6}
                >
                  <Ionicons name="add" size={15} color={colors.text} />
                </Pressable>
              </View>

              <Pressable onPress={() => removePart(p.stockId)} hitSlop={8}>
                <Ionicons name="close-circle" size={19} color={colors.textMuted} />
              </Pressable>
            </View>
          );
        })}

        <Pressable
          style={({ pressed }) => [
            styles.addPartButton,
            pressed && { opacity: 0.85 },
          ]}
          onPress={() => setPartsPicker(true)}
        >
          <Ionicons name="add" size={16} color={colors.primary} />
          <Text style={styles.addPartText}>Добавить расходник</Text>
        </Pressable>

        {/* Что именно уйдёт с остатка при сохранении */}
        {status === "done" && parts.length > 0 && lead?.partsDone !== "1" ? (
          <View style={styles.writeOffCard}>
            <Ionicons name="checkmark-circle" size={16} color="#4ade80" />
            <Text style={styles.writeOffText}>
              При сохранении спишется с остатка:{" "}
              {parts.map((p) => `${p.name} ×${formatQty(p.qty)}`).join(", ")}
            </Text>
          </View>
        ) : null}

        {lead?.partsDone === "1" ? (
          <Text style={styles.partsDoneHint}>
            ✓ Уже списано с остатка. Измените состав — разница учтётся сама.
          </Text>
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

        {/* Пока идёт сохранение, успокаиваем: без связи заявка не потеряется */}
        {busy ? (
          <Text style={styles.savingHint}>
            Сохраняю… Если связи нет, заявка останется в телефоне и отправится
            сама, как только появится интернет.
          </Text>
        ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Окно выбора города — показывается, только когда город не ясен из адреса */}
      {picker}

      {/* Выбор расходника из того, что лежит в машине */}
      <Modal
        visible={partsPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setPartsPicker(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPartsPicker(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Что израсходовали?</Text>
            <Text style={styles.modalSubtitle}>
              Список — ваши расходники в машине. Тап добавляет позицию к заявке.
            </Text>

            <ScrollView style={styles.modalList} keyboardShouldPersistTaps="handled">
              {stock.length === 0 ? (
                <Text style={styles.modalEmpty}>
                  Расходники не заведены. Откройте «Ещё → Расходники» и добавьте
                  позиции.
                </Text>
              ) : (
                stock.map((item) => {
                  const chosen = parts.find((p) => p.stockId === item.id);
                  return (
                    <Pressable
                      key={item.id}
                      style={[styles.modalRow, chosen && styles.modalRowActive]}
                      onPress={() => addPart(item)}
                    >
                      <View style={styles.partInfo}>
                        <Text style={styles.modalRowName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={styles.modalRowMeta}>
                          в машине {formatQty(item.qty)} {item.unit}
                        </Text>
                      </View>
                      {chosen ? (
                        <Text style={styles.modalChosen}>
                          ×{formatQty(chosen.qty)}
                        </Text>
                      ) : (
                        <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <Pressable
              style={({ pressed }) => [
                styles.modalDone,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setPartsPicker(false)}
            >
              <Text style={styles.modalDoneText}>Готово</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
  // Кнопка «позвонить» справа от поля телефона — в зелёный цвет статуса «Выполнена»
  callButton: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(34,197,94,0.18)",
    borderWidth: 1,
    borderColor: "#22c55e",
  },
  // Строка о повторном обращении — надпись без рамки, чтобы форма не пухла
  repeatRow: {
    backgroundColor: "rgba(245,162,11,0.1)",
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.35)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  repeatText: {
    color: colors.primary,
    fontSize: 12.5,
    fontWeight: "700",
    lineHeight: 18,
  },
  // Кнопка «открыть адрес в навигаторе» под полем адреса
  // Кнопка «открыть адрес в навигаторе» под полем адреса — белая, в цвет адреса
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 2,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: "rgba(245,245,245,0.28)",
  },
  routeRowText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  // Предупреждение о том, что заявка висит больше недели
  staleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.14)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.45)",
  },
  staleCardCritical: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderColor: "rgba(239,68,68,0.5)",
  },
  staleCardText: {
    flex: 1,
    color: "#fbbf24",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  staleCardTextCritical: {
    color: "#f87171",
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
  // --- Расходники на заявке ---
  partsHint: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
  },
  partRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 6,
  },
  partInfo: {
    flex: 1,
  },
  partName: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: "600",
  },
  partStock: {
    color: colors.textMuted,
    fontSize: 11.5,
    marginTop: 2,
  },
  // Позиции не хватает в машине — предупреждаем цветом
  partStockShort: {
    color: "#fbbf24",
  },
  partStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  partStepButton: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.inputBg,
  },
  partQty: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: "700",
    minWidth: 48,
    textAlign: "center",
  },
  addPartButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 11,
    backgroundColor: "rgba(245,162,11,0.08)",
  },
  addPartText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  // Зелёная плашка «что спишется» — в цвет статуса «Выполнена»
  writeOffCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(34,197,94,0.14)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.45)",
  },
  writeOffText: {
    flex: 1,
    color: "#4ade80",
    fontSize: 12.5,
    fontWeight: "600",
    lineHeight: 17,
  },
  partsDoneHint: {
    color: "#4ade80",
    fontSize: 12.5,
    marginTop: 4,
  },

  // --- Окно выбора расходника ---
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: "80%",
  },
  modalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 10,
  },
  modalList: {
    maxHeight: 340,
  },
  modalEmpty: {
    color: colors.textMuted,
    fontSize: 13.5,
    lineHeight: 19,
    paddingVertical: 12,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  modalRowActive: {
    borderColor: "#4ade80",
    backgroundColor: "rgba(34,197,94,0.12)",
  },
  modalRowName: {
    color: colors.text,
    fontSize: 14.5,
    fontWeight: "600",
  },
  modalRowMeta: {
    color: colors.textMuted,
    fontSize: 11.5,
    marginTop: 2,
  },
  modalChosen: {
    color: "#4ade80",
    fontSize: 14,
    fontWeight: "700",
  },
  modalDone: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
  },
  modalDoneText: {
    color: colors.primaryForeground,
    fontSize: 15.5,
    fontWeight: "700",
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
  dictationCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    gap: 8,
    marginBottom: 4,
  },
  dictationButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  dictationButtonActive: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  dictationButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "700",
  },
  dictationButtonTextActive: {
    color: colors.text,
  },
  dictationHint: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
  },
  dictationLive: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
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
  // Предупреждение под пустым телефоном: сохранить не мешает, но говорит,
  // что позвонить из такой заявки не выйдет.
  phoneWarning: {
    color: "#fbbf24",
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 6,
  },
  savingHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    textAlign: "center",
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

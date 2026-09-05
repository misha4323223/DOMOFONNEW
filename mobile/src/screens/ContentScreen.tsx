import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { api } from "../api";
import {
  cloneContent,
  DEFAULT_CONTENT,
  HOME_SECTIONS,
  sanitizeContent,
  type HomeContent,
} from "../content";
import { colors } from "../theme";

interface Props {
  token: string;
  onBack: () => void;
}

// --- Описание полей каждой секции (ключи совпадают с HomeContent) ---

type SimpleField = {
  key: string;
  label: string;
  multiline?: boolean;
  hint?: string;
};

type FieldDef =
  | ({ type: "text" } & SimpleField)
  | {
      type: "enum";
      key: string;
      label: string;
      options: { value: string; label: string }[];
    }
  | {
      type: "objectList";
      key: string;
      label: string;
      itemTitle: string;
      empty: Record<string, string | string[]>;
      fields: SimpleField[];
    };

const COVERAGE_OPTIONS = [
  { value: "visible", label: "👁 Показывать посетителям" },
  { value: "seo-only", label: "🔎 Только для поисковиков" },
  { value: "hidden", label: "🚫 Скрыть совсем" },
];

const NAV_FIELDS: SimpleField[] = [
  { key: "label", label: "Текст пункта" },
  { key: "href", label: "Ссылка (например #services)" },
];

const FIELDS: Record<string, FieldDef[]> = {
  seo: [
    { type: "text", key: "brandName", label: "Название бренда", hint: "Подставляется в подписи и og:site_name" },
    { type: "text", key: "title", label: "Заголовок страницы (title)", multiline: true, hint: "Виден в поисковой выдаче" },
    { type: "text", key: "description", label: "Описание (meta description)", multiline: true, hint: "Видно в поиске под заголовком" },
    { type: "text", key: "keywords", label: "Ключевые слова", multiline: true, hint: "Через запятую" },
  ],
  header: [
    { type: "text", key: "logoTitle", label: "Название в шапке" },
    { type: "text", key: "logoSubtitle", label: "Подпись в шапке" },
    { type: "text", key: "ctaText", label: "Текст кнопки «Оставить заявку»" },
    {
      type: "objectList",
      key: "nav",
      label: "Пункты меню",
      itemTitle: "Пункт меню",
      empty: { label: "", href: "" },
      fields: NAV_FIELDS,
    },
  ],
  hero: [
    { type: "text", key: "requestButtonText", label: "Текст кнопки «Оставить заявку»" },
    { type: "text", key: "servicesButtonText", label: "Текст кнопки «Наши услуги»" },
    { type: "text", key: "altText", label: "alt-текст фото (для поисковиков)", hint: "Опишите фото словами" },
  ],
  services: [
    { type: "text", key: "title", label: "Заголовок блока" },
    { type: "text", key: "subtitle", label: "Подзаголовок" },
    {
      type: "objectList",
      key: "items",
      label: "Услуги",
      itemTitle: "Услуга",
      empty: { title: "", description: "", features: [] },
      fields: [
        { key: "title", label: "Название" },
        { key: "description", label: "Описание", multiline: true },
      ],
    },
  ],
  benefits: [
    { type: "text", key: "title", label: "Заголовок блока" },
    { type: "text", key: "subtitle", label: "Подзаголовок" },
    {
      type: "objectList",
      key: "items",
      label: "Преимущества",
      itemTitle: "Преимущество",
      empty: { title: "", description: "" },
      fields: [
        { key: "title", label: "Название" },
        { key: "description", label: "Описание", multiline: true },
      ],
    },
  ],
  coverage: [
    { type: "enum", key: "mode", label: "Как показывать блок о городах", options: COVERAGE_OPTIONS },
    { type: "text", key: "title", label: "Заголовок блока", multiline: true },
    { type: "text", key: "subtitle", label: "Описание блока", multiline: true },
    {
      type: "objectList",
      key: "cities",
      label: "Города",
      itemTitle: "Город",
      empty: { name: "", note: "" },
      fields: [
        { key: "name", label: "Название города" },
        { key: "note", label: "Примечание", multiline: true },
      ],
    },
    { type: "text", key: "morePrefix", label: "Текст перед телефоном", multiline: true },
    { type: "text", key: "phoneLabel", label: "Телефон (текст)" },
    { type: "text", key: "phoneHref", label: "Телефон (ссылка tel:)" },
  ],
  form: [
    { type: "text", key: "title", label: "Заголовок формы" },
    { type: "text", key: "subtitle", label: "Подзаголовок формы", multiline: true },
    { type: "text", key: "nameLabel", label: "Поле «Имя» — подпись" },
    { type: "text", key: "namePlaceholder", label: "Поле «Имя» — подсказка" },
    { type: "text", key: "phoneLabel", label: "Поле «Телефон» — подпись" },
    { type: "text", key: "phonePlaceholder", label: "Поле «Телефон» — подсказка" },
    { type: "text", key: "serviceLabel", label: "Поле «Услуга» — подпись" },
    { type: "text", key: "servicePlaceholder", label: "Поле «Услуга» — подсказка" },
    { type: "text", key: "addressLabel", label: "Поле «Адрес» — подпись" },
    { type: "text", key: "addressPlaceholder", label: "Поле «Адрес» — подсказка" },
    { type: "text", key: "commentLabel", label: "Поле «Комментарий» — подпись" },
    { type: "text", key: "commentPlaceholder", label: "Поле «Комментарий» — подсказка", multiline: true },
    { type: "text", key: "consentText", label: "Текст согласия на обработку ПД", hint: "Идёт перед ссылкой на политику" },
    { type: "text", key: "privacyLinkText", label: "Текст ссылки на политику" },
    { type: "text", key: "callUsPrefix", label: "Текст перед телефоном внизу формы" },
    { type: "text", key: "phoneValue", label: "Телефон (текст)" },
    { type: "text", key: "phoneHref", label: "Телефон (ссылка tel:)" },
    {
      type: "objectList",
      key: "serviceOptions",
      label: "Список услуг в форме",
      itemTitle: "Услуга",
      empty: { value: "", label: "" },
      fields: [
        { key: "value", label: "Код услуги (лучше не менять)", hint: "По коду сохраняются заявки" },
        { key: "label", label: "Название в списке" },
      ],
    },
    { type: "text", key: "submitLabel", label: "Кнопка «Отправить заявку»" },
    { type: "text", key: "submittingLabel", label: "Кнопка во время отправки" },
    { type: "text", key: "successTitle", label: "Заголовок после отправки" },
    { type: "text", key: "successDescription", label: "Текст после отправки", multiline: true },
    { type: "text", key: "successToastTitle", label: "Заголовок всплывающего сообщения" },
    { type: "text", key: "toastDescription", label: "Текст всплывающего сообщения", multiline: true },
  ],
  contact: [
    { type: "text", key: "title", label: "Заголовок блока" },
    { type: "text", key: "subtitle", label: "Подзаголовок" },
    {
      type: "objectList",
      key: "items",
      label: "Карточки контактов",
      itemTitle: "Карточка",
      empty: { title: "", value: "", href: "" },
      fields: [
        { key: "title", label: "Заголовок" },
        { key: "value", label: "Значение" },
        { key: "href", label: "Ссылка (пусто — без ссылки)" },
      ],
    },
  ],
  footer: [
    { type: "text", key: "companyTitle", label: "Название компании" },
    { type: "text", key: "companyDescription", label: "Описание компании", multiline: true },
    { type: "text", key: "servicesTitle", label: "Заголовок колонки «Услуги»" },
    {
      type: "objectList",
      key: "servicesLinks",
      label: "Ссылки колонки «Услуги»",
      itemTitle: "Ссылка",
      empty: { label: "", href: "" },
      fields: NAV_FIELDS,
    },
    { type: "text", key: "contactsTitle", label: "Заголовок колонки «Контакты»" },
    {
      type: "objectList",
      key: "contactsLinks",
      label: "Ссылки колонки «Контакты»",
      itemTitle: "Ссылка",
      empty: { label: "", href: "" },
      fields: NAV_FIELDS,
    },
    { type: "text", key: "copyrightText", label: "Копирайт", hint: "Можно использовать {year} — подставится текущий год" },
    { type: "text", key: "developedByText", label: "Текст «Разработано в»" },
    { type: "text", key: "studioName", label: "Название студии" },
    { type: "text", key: "studioHref", label: "Ссылка на студию" },
    { type: "text", key: "requisites", label: "Реквизиты ИП", multiline: true },
    { type: "text", key: "privacyText", label: "Текст ссылки на политику" },
    { type: "text", key: "privacyHref", label: "Ссылка на политику" },
  ],
};

// Поля-списки внутри карточек (features у услуг), обрабатываются отдельно
const CARD_STRING_LISTS: Record<string, { listKey: string; label: string; addLabel: string }> = {
  "services.items": { listKey: "features", label: "Пункты списка услуги", addLabel: "+ Добавить пункт" },
};

// --- Вспомогательные функции правок ---

function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

export function ContentScreen({ token, onBack }: Props) {
  const [draft, setDraft] = useState<HomeContent>(() => cloneContent(DEFAULT_CONTENT));
  const [activeSection, setActiveSection] = useState<string>(HOME_SECTIONS[0].key);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getContent();
        setDraft(sanitizeContent(res.content));
      } catch (e) {
        // Продолжаем на дефолтных значениях — сайт читается и так
        setLoadError(e instanceof Error ? e.message : "Не удалось загрузить контент");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Универсальные помощники правок (секция — по ключу из HOME_SECTIONS) ---

  const patchSection = (section: string, patch: Record<string, unknown>) => {
    setDraft((d) => {
      const sec = (d as unknown as Record<string, unknown>)[section];
      return {
        ...d,
        [section]: { ...(sec as object), ...patch },
      } as HomeContent;
    });
  };

  const patchListItem = (
    section: string,
    listKey: string,
    index: number,
    patch: Record<string, string>,
  ) => {
    setDraft((d) => {
      const sec = (d as unknown as Record<string, unknown>)[section] as Record<string, unknown>;
      const list = (sec[listKey] as Record<string, string>[]) ?? [];
      const next = list.map((item, i) => (i === index ? { ...item, ...patch } : item));
      return { ...d, [section]: { ...sec, [listKey]: next } } as HomeContent;
    });
  };

  const addListItem = (section: string, listKey: string, empty: Record<string, string | string[]>) => {
    setDraft((d) => {
      const sec = (d as unknown as Record<string, unknown>)[section] as Record<string, unknown>;
      const list = (sec[listKey] as unknown[]) ?? [];
      return {
        ...d,
        [section]: { ...sec, [listKey]: [...list, cloneContent(empty)] },
      } as HomeContent;
    });
  };

  const removeListItem = (section: string, listKey: string, index: number) => {
    setDraft((d) => {
      const sec = (d as unknown as Record<string, unknown>)[section] as Record<string, unknown>;
      const list = (sec[listKey] as unknown[]) ?? [];
      return {
        ...d,
        [section]: { ...sec, [listKey]: list.filter((_, i) => i !== index) },
      } as HomeContent;
    });
  };

  const moveListItem = (section: string, listKey: string, index: number, delta: -1 | 1) => {
    setDraft((d) => {
      const sec = (d as unknown as Record<string, unknown>)[section] as Record<string, unknown>;
      const list = (sec[listKey] as unknown[]) ?? [];
      return {
        ...d,
        [section]: { ...sec, [listKey]: moveItem(list, index, delta) },
      } as HomeContent;
    });
  };

  // Правки вложенных списков строк внутри карточек (например, пункты списка услуг)
  const patchCardStringList = (
    section: string,
    objectListKey: string,
    innerKey: string,
    itemIndex: number,
    updater: (list: string[]) => string[],
  ) => {
    setDraft((d) => {
      const sec = (d as unknown as Record<string, unknown>)[section] as Record<string, unknown>;
      const list = (sec[objectListKey] as Record<string, string[]>[]) ?? [];
      const items = list.map((item, i) =>
        i === itemIndex ? { ...item, [innerKey]: updater(item[innerKey] ?? []) } : item,
      );
      return { ...d, [section]: { ...sec, [objectListKey]: items } } as HomeContent;
    });
  };

  // --- Сохранение ---

  const save = async () => {
    setSaving(true);
    try {
      await api.saveContent(token, draft);
      Alert.alert("Сохранено", "Изменения опубликованы на сайте obzor71.ru");
    } catch (e) {
      Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    Alert.alert(
      "Сбросить всё к стандарту?",
      "Все секции вернутся к исходным текстам. Нажмите «Сохранить», чтобы применить.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Сбросить",
          style: "destructive",
          onPress: () => setDraft(cloneContent(DEFAULT_CONTENT)),
        },
      ],
    );
  };

  // --- Загрузка своего фото первого экрана ---

  const uploadHeroImage = async (imageKey: "hero-desktop" | "hero-mobile") => {
    if (uploadingKey) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Доступ", "Разрешите доступ к фотографиям в настройках телефона");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;

      setUploadingKey(imageKey);
      const asset = result.assets[0];
      // Сжимаем до ширины 1600px в JPEG — сервер хранит фото в YDB (лимит записи ~400 КБ)
      const processed = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!processed.base64) throw new Error("Не удалось сжать фото");

      const dataUrl = `data:image/jpeg;base64,${processed.base64}`;
      if (dataUrl.length > 390_000) {
        Alert.alert("Фото слишком большое", "Выберите фото поменьше или менее детальное (лимит ~300 КБ)");
        return;
      }

      await api.uploadContentImage(token, imageKey, dataUrl);
      patchSection("hero", { [imageKey]: `/api/content/image/${imageKey}` });
      Alert.alert("Готово", "Фото загружено. Нажмите «Сохранить», чтобы применить на сайте.");
    } catch (e) {
      Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось загрузить фото");
    } finally {
      setUploadingKey(null);
    }
  };

  const resetHeroImage = (imageKey: "hero-desktop" | "hero-mobile") => {
    Alert.alert("Вернуть стандартное фото?", "Загруженное фото будет удалено с сайта.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Вернуть",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteContentImage(token, imageKey);
            patchSection("hero", { [imageKey]: "" });
          } catch (e) {
            Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось удалить фото");
          }
        },
      },
    ]);
  };

  // --- Рендер полей ---

  const renderField = (field: FieldDef, section: string) => {
    const sec = (draft as unknown as Record<string, unknown>)[section] as Record<string, unknown>;

    if (field.type === "text") {
      const value = (sec[field.key] as string) ?? "";
      return (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput
            style={[styles.input, field.multiline && styles.multiline]}
            value={value}
            onChangeText={(v) => patchSection(section, { [field.key]: v })}
            placeholderTextColor={colors.textMuted}
            multiline={field.multiline}
          />
          {field.hint ? <Text style={styles.hint}>{field.hint}</Text> : null}
        </View>
      );
    }

    if (field.type === "enum") {
      const value = (sec[field.key] as string) ?? "";
      return (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <View style={styles.chipRow}>
            {field.options.map((opt) => {
              const active = value === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => patchSection(section, { [field.key]: opt.value })}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      );
    }

    if (field.type === "objectList") {
      const list = (sec[field.key] as Record<string, unknown>[]) ?? [];
      return (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          {list.map((item, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {field.itemTitle} {i + 1}
                </Text>
                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => moveListItem(section, field.key, i, -1)}
                    disabled={i === 0}
                    hitSlop={8}
                    style={styles.cardActionButton}
                  >
                    <Text style={[styles.cardActionText, i === 0 && { opacity: 0.3 }]}>↑</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => moveListItem(section, field.key, i, 1)}
                    disabled={i === list.length - 1}
                    hitSlop={8}
                    style={styles.cardActionButton}
                  >
                    <Text style={[styles.cardActionText, i === list.length - 1 && { opacity: 0.3 }]}>↓</Text>
                  </Pressable>
                  <Pressable onPress={() => removeListItem(section, field.key, i)} hitSlop={8}>
                    <Text style={styles.removeText}>✕ Удалить</Text>
                  </Pressable>
                </View>
              </View>
              {field.fields.map((f) => (
                <View key={f.key}>
                  <Text style={styles.subLabel}>{f.label}</Text>
                  <TextInput
                    style={[styles.input, f.multiline && styles.multiline]}
                    value={String(item[f.key] ?? "")}
                    onChangeText={(v) => patchListItem(section, field.key, i, { [f.key]: v })}
                    placeholderTextColor={colors.textMuted}
                    multiline={f.multiline}
                  />
                  {f.hint ? <Text style={styles.hint}>{f.hint}</Text> : null}
                </View>
              ))}
              {/* Вложенные списки строк (например, пункты списка услуг) */}
              {CARD_STRING_LISTS[`${section}.${field.key}`] ? (() => {
                const sl = CARD_STRING_LISTS[`${section}.${field.key}`];
                const listKey = sl.listKey;
                const values = (item[listKey] as string[] | undefined) ?? [];
                return (
                  <View style={styles.field}>
                    <Text style={styles.subLabel}>{sl.label}</Text>
                    {values.map((v, vi) => (
                      <View key={vi} style={styles.stringRow}>
                        <TextInput
                          style={[styles.input, styles.stringInput]}
                          value={v}
                          onChangeText={(nv) =>
                            patchCardStringList(section, field.key, sl.listKey, i, (list) =>
                              list.map((x, xi) => (xi === vi ? nv : x)),
                            )
                          }
                          placeholderTextColor={colors.textMuted}
                        />
                        <Pressable
                          onPress={() =>
                            patchCardStringList(section, field.key, sl.listKey, i, (list) =>
                              list.filter((_, xi) => xi !== vi),
                            )
                          }
                          hitSlop={8}
                        >
                          <Text style={styles.removeText}>✕</Text>
                        </Pressable>
                      </View>
                    ))}
                    <Pressable
                      style={styles.addButton}
                      onPress={() =>
                        patchCardStringList(section, field.key, sl.listKey, i, (list) => [...list, ""])
                      }
                    >
                      <Text style={styles.addButtonText}>{sl.addLabel}</Text>
                    </Pressable>
                  </View>
                );
              })() : null}
            </View>
          ))}
          <Pressable style={styles.addButton} onPress={() => addListItem(section, field.key, field.empty)}>
            <Text style={styles.addButtonText}>+ Добавить {field.itemTitle.toLowerCase()}</Text>
          </Pressable>
        </View>
      );
    }

    return null;
  };

  const activeSectionMeta = HOME_SECTIONS.find((s) => s.key === activeSection)!;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>← Назад</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Контент сайта</Text>
        <View style={{ width: 64 }} />
      </View>

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sectionTabs}
        >
          {HOME_SECTIONS.map((s) => {
            const active = s.key === activeSection;
            return (
              <Pressable
                key={s.key}
                style={[styles.sectionTab, active && styles.sectionTabActive]}
                onPress={() => setActiveSection(s.key)}
              >
                <Text style={[styles.sectionTabText, active && styles.sectionTabTextActive]}>
                  {s.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionDescription}>{activeSectionMeta.description}</Text>

          {(FIELDS[activeSection] ?? []).map((f) => renderField(f, activeSection))}

          {/* Фото первого экрана */}
          {activeSection === "hero" ? (
            <View style={styles.field}>
              <Text style={styles.label}>Фото первого экрана</Text>
              {(["hero-desktop", "hero-mobile"] as const).map((key) => {
                const hero = draft.hero;
                const value = key === "hero-desktop" ? hero.desktopImage : hero.mobileImage;
                const label = key === "hero-desktop" ? "Десктоп (компьютер)" : "Мобильный телефон";
                const busy = uploadingKey === key;
                return (
                  <View key={key} style={styles.imageCard}>
                    <Text style={styles.subLabel}>{label}</Text>
                    <Text style={styles.hint}>
                      {value ? "Своё фото загружено" : "Стандартное фото из сборки сайта"}
                    </Text>
                    <View style={styles.chipRow}>
                      <Pressable
                        style={[styles.chip, styles.chipActive, busy && { opacity: 0.6 }]}
                        onPress={() => uploadHeroImage(key)}
                        disabled={busy}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color={colors.primaryForeground} />
                        ) : (
                          <Text style={[styles.chipText, styles.chipTextActive]}>
                            {value ? "📷 Заменить фото" : "📷 Загрузить своё фото"}
                          </Text>
                        )}
                      </Pressable>
                      {value ? (
                        <Pressable style={styles.chip} onPress={() => resetHeroImage(key)}>
                          <Text style={styles.chipText}>↩ Вернуть стандартное</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              <Text style={styles.hint}>
                Фото сжимается до 1600px и хранится на сервере. Применится после «Сохранить».
              </Text>
            </View>
          ) : null}

          {loadError ? <Text style={styles.loadError}>⚠ Не удалось загрузить текущие тексты: {loadError}</Text> : null}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.resetButton, pressed && { opacity: 0.8 }]}
          onPress={resetAll}
        >
          <Text style={styles.resetButtonText}>Сбросить к стандарту</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            (saving || loading) && { opacity: 0.6 },
            pressed && { opacity: 0.85 },
          ]}
          onPress={save}
          disabled={saving || loading}
        >
          {saving ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={styles.saveButtonText}>💾 Сохранить на сайте</Text>
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
    minWidth: 64,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  sectionTabs: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  sectionTab: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  sectionTabActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  sectionTabText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  sectionTabTextActive: {
    color: colors.primaryForeground,
  },
  sectionDescription: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  content: {
    padding: 16,
    paddingBottom: 24,
    gap: 4,
  },
  field: {
    marginBottom: 14,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  subLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    opacity: 0.8,
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
    minHeight: 64,
    textAlignVertical: "top",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.inputBg,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: colors.primaryForeground,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardActionButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  cardActionText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  removeText: {
    color: colors.destructive,
    fontSize: 12,
    fontWeight: "600",
  },
  stringRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  stringInput: {
    flex: 1,
  },
  addButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
    backgroundColor: "rgba(245,162,11,0.08)",
  },
  addButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  imageCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    marginBottom: 10,
  },
  loadError: {
    color: "#fbbf24",
    fontSize: 12,
    marginTop: 8,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  resetButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  resetButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  saveButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: "700",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
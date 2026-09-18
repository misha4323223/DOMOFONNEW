import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { api, isNetworkError, isServerError } from "../api";
import {
  newBlock,
  newPage,
  normalizeSlug,
  PAGE_BLOCK_HINTS,
  PAGE_BLOCK_LABELS,
  PAGE_BLOCK_TYPES,
  PAGE_LIMITS,
  PAGE_SLUG_PATTERN,
  RESERVED_SLUGS,
  sanitizePages,
  type PageBlock,
  type PageBlockType,
  type SitePage,
} from "../pages";
import { colors } from "../theme";

/**
 * Конструктор дополнительных страниц сайта — тот же, что в админке на сайте
 * («Сайт → Страницы сайта»), но с телефона.
 *
 * Страницы живут одним документом на сервере (/api/admin/pages), каждая
 * открывается на сайте по адресу /p/<slug>. Фото блоков загружаются
 * отдельно (/api/admin/pages/image) и хранятся на сервере.
 *
 * Сохранение — только при интернете: у страниц нет офлайн-очереди (в отличие
 * от заявок). Если связи нет, приложение прямо об этом скажет и оставит
 * правки на экране, чтобы их не потерять.
 */

interface Props {
  token: string;
  onBack: () => void;
}

/** Ошибка в адресе страницы или пусто, если адрес годный. */
function slugError(page: SitePage, pages: SitePage[]): string {
  const raw = (page.slug ?? "").trim();
  const slug = normalizeSlug(raw);
  if (!raw) return "Укажите адрес страницы (латиницей, например ceny).";
  // Русские буквы и прочие символы normalizeSlug просто убирает: без этой
  // проверки адрес стал бы пустым молча.
  if (!slug || !PAGE_SLUG_PATTERN.test(slug)) {
    return "Адрес — латиница в нижнем регистре, цифры и дефис (например kak-rabotaem).";
  }
  if (RESERVED_SLUGS.includes(slug)) return `Адрес «${slug}» занят разделом сайта.`;
  if (pages.filter((p) => normalizeSlug(p.slug) === slug).length > 1) {
    return "Такой адрес уже есть у другой страницы.";
  }
  return "";
}

function moveItem<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** Идентификатор фото страницы из его адреса (/api/content/page-image/<id>). */
function pageImageId(url: string): string | null {
  // Ровно тот формат, который принимает сервер (см. PAGE_IMAGE_ID_RE)
  const m = /^\/api\/content\/page-image\/([0-9a-f]{16})$/.exec(url);
  return m ? m[1] : null;
}

export function PagesScreen({ token, onBack }: Props) {
  const [pages, setPages] = useState<SitePage[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Какой блок сейчас грузит фото (индекс блока) — чтобы показать крутилку.
  const [uploadingBlock, setUploadingBlock] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getAdminPages(token);
        setPages(sanitizePages(res.pages));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Не удалось загрузить страницы");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const activePage = activeIndex === null ? null : pages[activeIndex] ?? null;

  // --- Правки ---

  const patchPage = (index: number, patch: Partial<SitePage>) => {
    setPages((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const patchBlock = (pageIndex: number, blockIndex: number, patch: Partial<PageBlock>) => {
    setPages((list) =>
      list.map((p, i) =>
        i === pageIndex
          ? {
              ...p,
              blocks: p.blocks.map((b, bi) => (bi === blockIndex ? { ...b, ...patch } : b)),
            }
          : p,
      ),
    );
  };

  const addBlock = (pageIndex: number, type: PageBlockType) => {
    setPages((list) =>
      list.map((p, i) => {
        if (i !== pageIndex) return p;
        if (p.blocks.length >= PAGE_LIMITS.maxBlocks) {
          Alert.alert("Больше блоков не добавить", `Лимит — ${PAGE_LIMITS.maxBlocks} блоков.`);
          return p;
        }
        return { ...p, blocks: [...p.blocks, newBlock(type)] };
      }),
    );
  };

  const removeBlock = (pageIndex: number, blockIndex: number) => {
    setPages((list) =>
      list.map((p, i) =>
        i === pageIndex ? { ...p, blocks: p.blocks.filter((_, bi) => bi !== blockIndex) } : p,
      ),
    );
  };

  const moveBlock = (pageIndex: number, blockIndex: number, delta: -1 | 1) => {
    setPages((list) =>
      list.map((p, i) =>
        i === pageIndex ? { ...p, blocks: moveItem(p.blocks, blockIndex, delta) } : p,
      ),
    );
  };

  const addPage = () => {
    if (pages.length >= PAGE_LIMITS.maxPages) {
      Alert.alert("Больше страниц не добавить", `Лимит — ${PAGE_LIMITS.maxPages} страниц.`);
      return;
    }
    setPages((list) => [...list, newPage("")]);
    setActiveIndex(pages.length);
  };

  const removePage = (index: number) => {
    const page = pages[index];
    Alert.alert(
      "Удалить страницу?",
      `«${page.menuLabel || page.title || page.slug}» пропадёт с сайта. Действие необратимо.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: () => {
            setPages((list) => list.filter((_, i) => i !== index));
            setActiveIndex(null);
          },
        },
      ],
    );
  };

  const movePage = (index: number, delta: -1 | 1) => {
    setPages((list) => moveItem(list, index, delta));
    setActiveIndex((current) => (current === null ? null : current + (current === index ? delta : 0)));
  };

  // --- Фото блока ---

  const pickImage = async (blockIndex: number) => {
    if (activeIndex === null) return;
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

      setUploadingBlock(blockIndex);
      // Сжимаем до 1600px в JPEG: сервер хранит фото одной записью YDB (~400 КБ)
      const processed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 1600 } }],
        { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!processed.base64) throw new Error("Не удалось сжать фото");
      const dataUrl = `data:image/jpeg;base64,${processed.base64}`;
      if (dataUrl.length > 390_000) {
        Alert.alert("Фото слишком большое", "Выберите фото поменьше (лимит ~300 КБ)");
        return;
      }

      const previous = pages[activeIndex]?.blocks[blockIndex]?.url ?? "";
      const res = await api.uploadPageImage(token, dataUrl);
      patchBlock(activeIndex, blockIndex, { url: res.url });
      // Заменённое фото убираем с сервера, чтобы не копился мусор
      const oldId = pageImageId(previous);
      if (oldId) await api.deletePageImage(token, oldId).catch(() => undefined);
      Alert.alert("Фото загружено", "Не забудьте нажать «Сохранить на сайте».");
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        Alert.alert(
          "Нет связи",
          "Фото грузится только при интернете. Попробуйте ещё раз, когда появится связь.",
        );
      } else {
        Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось загрузить фото");
      }
    } finally {
      setUploadingBlock(null);
    }
  };

  const clearImage = (blockIndex: number) => {
    if (activeIndex === null) return;
    const block = pages[activeIndex]?.blocks[blockIndex];
    if (!block) return;
    Alert.alert("Убрать фото?", "Фото будет удалено и со страницы, и с сервера.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Убрать",
        style: "destructive",
        onPress: async () => {
          patchBlock(activeIndex, blockIndex, { url: "" });
          const id = pageImageId(block.url);
          if (!id) return;
          try {
            await api.deletePageImage(token, id);
          } catch {
            // Фото убрано со страницы; на сервере оно просто останется неиспользованным
          }
        },
      },
    ]);
  };

  // --- Сохранение ---

  const save = async () => {
    // Пустые адреса и повторы сервер молча отбросит — лучше сказать сразу.
    const broken = pages.findIndex((p) => slugError(p, pages));
    if (broken >= 0) {
      Alert.alert("Проверьте адрес страницы", slugError(pages[broken], pages));
      setActiveIndex(broken);
      return;
    }

    setSaving(true);
    try {
      const res = await api.saveAdminPages(token, pages);
      setPages(sanitizePages(res.pages));
      Alert.alert("Сохранено", "Страницы обновлены на сайте obzor71.ru");
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        Alert.alert(
          "Нет связи",
          "Страницы сохраняются только при интернете. Правки остались в приложении — " +
            "нажмите «Сохранить» ещё раз, когда связь появится.",
        );
      } else {
        Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось сохранить страницы");
      }
    } finally {
      setSaving(false);
    }
  };

  // --- Отрисовка блока ---

  const renderBlock = (block: PageBlock, blockIndex: number, pageIndex: number) => {
    return (
      <View key={blockIndex} style={styles.blockCard}>
        <View style={styles.blockHeader}>
          <Text style={styles.blockTitle}>
            {blockIndex + 1}. {PAGE_BLOCK_LABELS[block.type]}
          </Text>
          <View style={styles.blockActions}>
            <Pressable
              hitSlop={8}
              disabled={blockIndex === 0}
              onPress={() => moveBlock(pageIndex, blockIndex, -1)}
            >
              <Ionicons
                name="arrow-up"
                size={16}
                color={blockIndex === 0 ? colors.cardBorder : colors.textMuted}
              />
            </Pressable>
            <Pressable
              hitSlop={8}
              disabled={blockIndex === pages[pageIndex].blocks.length - 1}
              onPress={() => moveBlock(pageIndex, blockIndex, 1)}
            >
              <Ionicons
                name="arrow-down"
                size={16}
                color={
                  blockIndex === pages[pageIndex].blocks.length - 1
                    ? colors.cardBorder
                    : colors.textMuted
                }
              />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => removeBlock(pageIndex, blockIndex)}>
              <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.hint}>{PAGE_BLOCK_HINTS[block.type]}</Text>

        {block.type === "heading" ? (
          <>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={block.text}
              onChangeText={(text) => patchBlock(pageIndex, blockIndex, { text })}
              placeholder="Например: Цены на установку"
              placeholderTextColor={colors.textMuted}
              multiline
            />
            <View style={styles.chipRow}>
              {[
                { value: "2", label: "Крупный" },
                { value: "3", label: "Помельче" },
              ].map((level) => {
                const active = (block.level === "3" ? "3" : "2") === level.value;
                return (
                  <Pressable
                    key={level.value}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => patchBlock(pageIndex, blockIndex, { level: level.value })}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {level.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {block.type === "text" ? (
          <TextInput
            style={[styles.input, styles.multilineTall]}
            value={block.text}
            onChangeText={(text) => patchBlock(pageIndex, blockIndex, { text })}
            placeholder="Текст страницы. Каждая новая строка — отдельный абзац."
            placeholderTextColor={colors.textMuted}
            multiline
          />
        ) : null}

        {block.type === "list" ? (
          <View>
            {block.items.map((item, itemIndex) => (
              <View key={itemIndex} style={styles.itemRow}>
                <TextInput
                  style={[styles.input, styles.itemInput]}
                  value={item}
                  onChangeText={(text) =>
                    patchBlock(pageIndex, blockIndex, {
                      items: block.items.map((v, i) => (i === itemIndex ? text : v)),
                    })
                  }
                  placeholder="Пункт списка"
                  placeholderTextColor={colors.textMuted}
                />
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    patchBlock(pageIndex, blockIndex, {
                      items: block.items.filter((_, i) => i !== itemIndex),
                    })
                  }
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
            <Pressable
              style={styles.smallButton}
              onPress={() =>
                patchBlock(pageIndex, blockIndex, {
                  items:
                    block.items.length >= PAGE_LIMITS.maxListItems
                      ? block.items
                      : [...block.items, ""],
                })
              }
            >
              <Text style={styles.smallButtonText}>+ Добавить пункт</Text>
            </Pressable>
          </View>
        ) : null}

        {block.type === "image" ? (
          <View>
            <Text style={styles.subLabel}>
              {block.url ? "Фото загружено" : "Фото пока нет"}
            </Text>
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, styles.chipActive, uploadingBlock === blockIndex && { opacity: 0.6 }]}
                disabled={uploadingBlock === blockIndex}
                onPress={() => void pickImage(blockIndex)}
              >
                {uploadingBlock === blockIndex ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.chipText, styles.chipTextActive]}>
                    {block.url ? "📷 Заменить фото" : "📷 Загрузить фото с телефона"}
                  </Text>
                )}
              </Pressable>
              {block.url ? (
                <Pressable style={styles.chip} onPress={() => clearImage(blockIndex)}>
                  <Text style={styles.chipText}>🗑 Убрать</Text>
                </Pressable>
              ) : null}
            </View>
            <TextInput
              style={styles.input}
              value={block.alt}
              onChangeText={(alt) => patchBlock(pageIndex, blockIndex, { alt })}
              placeholder="Описание фото словами (для поиска)"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        ) : null}

        {block.type === "button" ? (
          <View>
            <TextInput
              style={styles.input}
              value={block.text}
              onChangeText={(text) => patchBlock(pageIndex, blockIndex, { text })}
              placeholder="Надпись на кнопке — «Позвонить»"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={block.href}
              onChangeText={(href) => patchBlock(pageIndex, blockIndex, { href })}
              placeholder="Ссылка: /p/ceny, https://… или tel:+7…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
            />
            <Text style={styles.hint}>
              Без корректной ссылки кнопка на странице не появится — проверьте адрес.
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  // --- Экран ---

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (activePage ? setActiveIndex(null) : onBack())}
          hitSlop={12}
        >
          <Text style={styles.back}>{activePage ? "← К страницам" : "← Назад"}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Страницы сайта</Text>
        <View style={{ width: 96 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.hint}>Загружаем страницы сайта…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {loadError ? (
            <Text style={styles.loadError}>⚠ Не удалось загрузить страницы: {loadError}</Text>
          ) : null}

          {activePage === null ? (
            /* Список страниц */
            <>
              <Text style={styles.sectionDescription}>
                Свои страницы сайта: «Цены», «Акции», «Как мы работаем». Открываются по адресу
                obzor71.ru/p/…, ссылки — в меню и подвале, страницы попадают в карту сайта.
              </Text>

              {pages.length === 0 ? (
                <Text style={styles.empty}>Своих страниц пока нет.</Text>
              ) : (
                pages.map((page, index) => (
                  <View key={index} style={styles.pageRow}>
                    <Pressable style={styles.pageMain} onPress={() => setActiveIndex(index)}>
                      <Text style={styles.pageTitle} numberOfLines={1}>
                        {page.menuLabel || page.title || "Без названия"}
                      </Text>
                      <Text style={styles.pageMeta} numberOfLines={1}>
                        /p/{page.slug || "—"} · {page.blocks.length} блок(ов)
                        {page.visible ? "" : " · скрыта"}
                        {page.showInMenu && page.visible ? " · в меню" : ""}
                      </Text>
                      {slugError(page, pages) ? (
                        <Text style={styles.pageError}>{slugError(page, pages)}</Text>
                      ) : null}
                    </Pressable>
                    <View style={styles.blockActions}>
                      <Pressable
                        hitSlop={8}
                        disabled={index === 0}
                        onPress={() => movePage(index, -1)}
                      >
                        <Ionicons
                          name="chevron-up"
                          size={18}
                          color={index === 0 ? colors.cardBorder : colors.textMuted}
                        />
                      </Pressable>
                      <Pressable
                        hitSlop={8}
                        disabled={index === pages.length - 1}
                        onPress={() => movePage(index, 1)}
                      >
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={index === pages.length - 1 ? colors.cardBorder : colors.textMuted}
                        />
                      </Pressable>
                      <Pressable hitSlop={8} onPress={() => removePage(index)}>
                        <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                      </Pressable>
                    </View>
                  </View>
                ))
              )}

              <Pressable style={styles.addPage} onPress={addPage}>
                <Ionicons name="add" size={20} color={colors.primaryForeground} />
                <Text style={styles.addPageText}>Добавить страницу</Text>
              </Pressable>
              <Text style={styles.hint}>
                Лимит — {PAGE_LIMITS.maxPages} страниц. Порядок в списке = порядок ссылок в меню.
              </Text>
            </>
          ) : (
            /* Редактор страницы */
            <>
              {slugError(activePage, pages) ? (
                <Text style={styles.loadError}>⚠ {slugError(activePage, pages)}</Text>
              ) : null}

              <View style={styles.field}>
                <Text style={styles.label}>Адрес страницы (латиницей)</Text>
                <TextInput
                  style={styles.input}
                  value={activePage.slug}
                  onChangeText={(slug) =>
                    patchPage(activeIndex!, { slug: slug.toLowerCase() })
                  }
                  placeholder="ceny"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
                <Text style={styles.hint}>
                  Откроется по адресу /p/{activePage.slug || "…"}. Менять после публикации не
                  стоит: старая ссылка перестанет работать.
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Заголовок страницы (H1)</Text>
                <TextInput
                  style={styles.input}
                  value={activePage.title}
                  onChangeText={(title) => patchPage(activeIndex!, { title })}
                  placeholder="Цены на установку домофонов"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Название ссылки в меню</Text>
                <TextInput
                  style={styles.input}
                  value={activePage.menuLabel}
                  onChangeText={(menuLabel) => patchPage(activeIndex!, { menuLabel })}
                  placeholder="Пусто — возьмётся заголовок"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Показывать посетителям</Text>
                <Switch
                  value={activePage.visible}
                  onValueChange={(visible) => patchPage(activeIndex!, { visible })}
                  trackColor={{ false: colors.cardBorder, true: colors.primary }}
                  thumbColor={colors.white}
                />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Ссылка в меню и подвале</Text>
                <Switch
                  value={activePage.showInMenu}
                  onValueChange={(showInMenu) => patchPage(activeIndex!, { showInMenu })}
                  trackColor={{ false: colors.cardBorder, true: colors.primary }}
                  thumbColor={colors.white}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Заголовок для поиска (title)</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={activePage.seoTitle}
                  onChangeText={(seoTitle) => patchPage(activeIndex!, { seoTitle })}
                  placeholder="Пусто — возьмётся заголовок страницы"
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Описание для поиска (description)</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={activePage.seoDescription}
                  onChangeText={(seoDescription) =>
                    patchPage(activeIndex!, { seoDescription })
                  }
                  placeholder="Пара предложений для выдачи Яндекса"
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
              </View>

              <Text style={styles.sectionTitle}>Блоки страницы</Text>
              {activePage.blocks.map((block, blockIndex) =>
                renderBlock(block, blockIndex, activeIndex!),
              )}

              <Text style={styles.subLabel}>Добавить блок</Text>
              <View style={styles.chipRow}>
                {PAGE_BLOCK_TYPES.map((type) => (
                  <Pressable
                    key={type}
                    style={styles.chip}
                    onPress={() => addBlock(activeIndex!, type)}
                  >
                    <Text style={styles.chipText}>+ {PAGE_BLOCK_LABELS[type]}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hint}>
                Пустой блок на сайте не появится — заполните текст, список или фото.
              </Text>
            </>
          )}
        </ScrollView>
      )}

      <View style={styles.footer}>
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
  root: { flex: 1, backgroundColor: colors.background },
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
  back: { color: colors.primary, fontSize: 15, fontWeight: "600", minWidth: 96 },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  content: { padding: 16, paddingBottom: 24 },
  sectionDescription: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 10,
    marginBottom: 10,
  },
  empty: { color: colors.textMuted, fontSize: 13, marginBottom: 12 },
  loadError: { color: "#fbbf24", fontSize: 12.5, marginBottom: 10 },
  pageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  pageMain: { flex: 1 },
  pageTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  pageMeta: { color: colors.textMuted, fontSize: 11.5, marginTop: 2 },
  pageError: { color: "#fbbf24", fontSize: 11, marginTop: 3 },
  addPage: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    marginTop: 4,
    marginBottom: 8,
  },
  addPageText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "700" },
  field: { marginBottom: 14 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  subLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 6,
  },
  hint: { color: colors.textMuted, fontSize: 11, marginTop: 4, opacity: 0.8 },
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
  multiline: { minHeight: 56, textAlignVertical: "top" },
  multilineTall: { minHeight: 96, textAlignVertical: "top" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  itemInput: { flex: 1 },
  smallButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 4,
  },
  smallButtonText: { color: colors.text, fontSize: 12.5, fontWeight: "600" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.primaryForeground },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  switchLabel: { color: colors.text, fontSize: 13.5, fontWeight: "600" },
  blockCard: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    backgroundColor: colors.card,
    padding: 12,
    marginBottom: 10,
  },
  blockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  blockTitle: { color: colors.text, fontSize: 13.5, fontWeight: "700" },
  blockActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
    padding: 12,
  },
  saveButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  saveButtonText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "700" },
});

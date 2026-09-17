import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { api, type SpellIssue } from "../api";
import { colors } from "../theme";

/**
 * Проверка орфографии текста с подсветкой найденных слов и вариантами замены.
 *
 * Используется в редакторе текстов сайта и в ответах на отзывы — там по кнопке:
 * текст уходит на внешний сервис проверки, поэтому в заявках и заметках с
 * адресами и телефонами клиентов проверку не предлагаем.
 */

interface Props {
  token: string;
  /** Исходный текст поля. */
  text: string;
  /** Вызывается только если текст реально поправили. */
  onApply: (next: string) => void;
  onClose: () => void;
}

/** Кусок текста для показа: обычный или с ошибкой (подсвечиваем). */
interface Segment {
  value: string;
  bad: boolean;
}

/** Разбить текст на куски, помечая найденные ошибки (пересечения пропускаем). */
function buildSegments(text: string, issues: SpellIssue[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const issue of issues) {
    if (issue.offset < cursor || issue.offset + issue.length > text.length) continue;
    if (issue.offset > cursor) {
      segments.push({ value: text.slice(cursor, issue.offset), bad: false });
    }
    segments.push({ value: text.slice(issue.offset, issue.offset + issue.length), bad: true });
    cursor = issue.offset + issue.length;
  }
  if (cursor < text.length) segments.push({ value: text.slice(cursor), bad: false });
  return segments;
}

export function SpellCheckPanel({ token, text, onApply, onClose }: Props) {
  // Текущий текст: правки применяем здесь же, чтобы человек видел результат.
  const [current, setCurrent] = useState(text);
  const [issues, setIssues] = useState<SpellIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(
    async (value: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.checkSpelling(token, value);
        setIssues(result.issues);
      } catch (err) {
        setIssues([]);
        setError(err instanceof Error ? err.message : "Не удалось проверить текст");
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  // Проверяем при открытии окна.
  useEffect(() => {
    void check(text);
  }, [check, text]);

  /** Заменить одну ошибку и сдвинуть смещения оставшихся — без нового запроса. */
  const applyFix = (index: number, replacement: string) => {
    const issue = issues[index];
    if (!issue) return;
    const next = current.slice(0, issue.offset) + replacement + current.slice(issue.offset + issue.length);
    const delta = replacement.length - issue.length;

    setCurrent(next);
    setIssues(
      issues
        .filter((_, i) => i !== index)
        .map((item) => (item.offset > issue.offset ? { ...item, offset: item.offset + delta } : item)),
    );
  };

  /** Заменить все ошибки первым предложенным вариантом и перепроверить текст. */
  const applyAll = () => {
    let next = current;
    for (const issue of [...issues].reverse()) {
      const replacement = issue.suggestions[0];
      if (!replacement) continue;
      next = next.slice(0, issue.offset) + replacement + next.slice(issue.offset + issue.length);
    }
    setCurrent(next);
    void check(next);
  };

  const fixableCount = issues.filter((issue) => issue.suggestions.length > 0).length;
  const segments = useMemo(() => buildSegments(current, issues), [current, issues]);

  const finish = () => {
    if (current !== text) onApply(current);
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Проверка орфографии</Text>
            <Pressable onPress={finish} hitSlop={10}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>Проверяем текст…</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.muted}>Проверка работает только при интернете</Text>
              <Pressable style={styles.primaryButton} onPress={() => void check(current)}>
                <Text style={styles.primaryButtonText}>Повторить</Text>
              </Pressable>
            </View>
          ) : issues.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.okText}>✅ Ошибок не найдено</Text>
              <Text style={styles.muted}>Если правили текст — он сохранится при нажатии «Готово»</Text>
            </View>
          ) : (
            <>
              <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
                <Text style={styles.label}>Как сейчас</Text>
                <View style={styles.preview}>
                  <Text style={styles.previewText}>
                    {segments.map((segment, i) =>
                      segment.bad ? (
                        <Text key={i} style={styles.previewBad}>
                          {segment.value}
                        </Text>
                      ) : (
                        <Text key={i}>{segment.value}</Text>
                      ),
                    )}
                  </Text>
                </View>

                <View style={styles.countRow}>
                  <Text style={styles.countText}>
                    Найдено: {issues.length}
                    {fixableCount !== issues.length ? ` (с заменами: ${fixableCount})` : ""}
                  </Text>
                  {fixableCount > 0 ? (
                    <Pressable onPress={applyAll} hitSlop={8}>
                      <Text style={styles.fixAll}>Исправить все</Text>
                    </Pressable>
                  ) : null}
                </View>

                {issues.map((issue, index) => (
                  <View key={`${issue.offset}-${issue.word}`} style={styles.issue}>
                    <Text style={styles.issueWord}>{issue.word}</Text>
                    <Text style={styles.issueMessage}>{issue.message}</Text>
                    <View style={styles.chipRow}>
                      {issue.suggestions.map((suggestion) => (
                        <Pressable
                          key={suggestion}
                          style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
                          onPress={() => applyFix(index, suggestion)}
                        >
                          <Text style={styles.chipText}>{suggestion}</Text>
                        </Pressable>
                      ))}
                      {issue.suggestions.length === 0 ? (
                        <Text style={styles.muted}>Вариантов замены нет — поправьте вручную</Text>
                      ) : null}
                    </View>
                  </View>
                ))}

                <Text style={styles.note}>
                  Проверяет внешний сервис LanguageTool — текст отправляется туда
                </Text>
              </ScrollView>

              <Pressable style={styles.primaryButton} onPress={finish}>
                <Text style={styles.primaryButtonText}>
                  {current !== text ? "Применить правки" : "Готово"}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  card: {
    width: "100%",
    maxHeight: "86%",
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  close: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: "700",
  },
  center: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 18,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: "center",
  },
  errorText: {
    color: "#f87171",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  okText: {
    color: "#4ade80",
    fontSize: 15,
    fontWeight: "800",
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    gap: 10,
    paddingVertical: 4,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  preview: {
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
  },
  previewText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  previewBad: {
    color: "#f87171",
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  countText: {
    color: colors.text,
    fontSize: 13.5,
    fontWeight: "700",
  },
  fixAll: {
    color: colors.primary,
    fontSize: 13.5,
    fontWeight: "800",
  },
  issue: {
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 10,
    gap: 6,
  },
  issueWord: {
    color: "#f87171",
    fontSize: 14.5,
    fontWeight: "800",
  },
  issueMessage: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    backgroundColor: "rgba(245,162,11,0.14)",
    borderWidth: 1,
    borderColor: "rgba(245,162,11,0.45)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    color: colors.primary,
    fontSize: 13.5,
    fontWeight: "700",
  },
  note: {
    color: colors.textMuted,
    fontSize: 11.5,
    lineHeight: 16,
  },
  primaryButton: {
    borderRadius: 12,
    backgroundColor: colors.primary,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: "800",
  },
});

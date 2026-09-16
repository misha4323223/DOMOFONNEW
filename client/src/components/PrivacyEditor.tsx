import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldShell, ListInput } from "@/components/EditorField";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DEFAULT_PRIVACY, sanitizePrivacy, type PrivacyContent } from "@shared/privacy";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";

/**
 * Раздел «Политика конфиденциальности».
 *
 * Раньше текст был зашит в код страницы (client/src/pages/Privacy.tsx) —
 * правка требовала программиста. Теперь текст живёт в настройках сайта:
 * админ меняет формулировки и дату актуализации сам, а страница и её
 * HTML для поисковиков обновляются сразу после сохранения.
 */
export function PrivacyEditor() {
  const { toast } = useToast();
  const [content, setContent] = useState<PrivacyContent | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const baseJson = useRef("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/privacy", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { content?: unknown };
      const clean = sanitizePrivacy(data.content ?? {});
      setContent(clean);
      baseJson.current = JSON.stringify(clean);
    } catch {
      setLoadError(
        "Не удалось загрузить текст политики. Проверьте подключение и попробуйте ещё раз.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-16 text-center">
        <p className="text-muted-foreground">{loadError}</p>
        <Button className="mt-4" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Попробовать снова
        </Button>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загружаем текст политики…
      </div>
    );
  }

  const dirty = JSON.stringify(content) !== baseJson.current;
  const patch = (patchValue: Partial<PrivacyContent>) =>
    setContent((prev) => (prev ? { ...prev, ...patchValue } : prev));

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/privacy", { content });
      const data = (await res.json()) as { content?: unknown };
      const clean = sanitizePrivacy(data.content ?? content);
      setContent(clean);
      baseJson.current = JSON.stringify(clean);
      toast({
        title: "Сохранено",
        description: "Страница /privacy обновлена.",
      });
    } catch (err) {
      toast({
        title: "Не удалось сохранить",
        description: err instanceof Error ? err.message : "Попробуйте ещё раз",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    if (
      !window.confirm(
        "Вернуть стандартный текст политики? Ваши правки будут потеряны.",
      )
    ) {
      return;
    }
    setContent(JSON.parse(JSON.stringify(DEFAULT_PRIVACY)) as PrivacyContent);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= content.sections.length) return;
    const sections = [...content.sections];
    [sections[index], sections[target]] = [sections[target], sections[index]];
    patch({ sections });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">
            Политика конфиденциальности
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Текст страницы <span className="font-mono">/privacy</span>. Ссылка
            на неё стоит в форме заявки и в подвале — её адрес менять не нужно.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Есть несохранённые изменения
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={resetToDefault}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Вернуть стандартный текст
          </Button>
          <Button size="lg" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Сохранить
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border bg-card/50 p-5 sm:p-6 space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <FieldShell label="Заголовок страницы (H1)">
              <Input
                value={content.title}
                onChange={(event) => patch({ title: event.target.value })}
              />
            </FieldShell>
            <FieldShell
              label="Строка под заголовком"
              hint="Например дата актуализации: «Дата актуализации: 02 сентября 2026 г.»"
            >
              <Input
                value={content.updatedLabel}
                onChange={(event) => patch({ updatedLabel: event.target.value })}
              />
            </FieldShell>
          </div>
          <FieldShell
            label="Заголовок для поисковой выдачи (title)"
            hint="Этот текст виден в Яндексе и Google вместо обычного заголовка."
          >
            <Input
              value={content.seoTitle}
              onChange={(event) => patch({ seoTitle: event.target.value })}
            />
          </FieldShell>
          <FieldShell label="Описание для поисковой выдачи">
            <Textarea
              value={content.seoDescription}
              rows={3}
              className="resize-y"
              onChange={(event) => patch({ seoDescription: event.target.value })}
            />
          </FieldShell>
        </div>

        {content.sections.map((section, index) => (
          <div
            key={index}
            className="rounded-2xl border bg-card/40 p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Раздел {index + 1}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Выше"
                  disabled={index === 0}
                  onClick={() => moveSection(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Ниже"
                  disabled={index === content.sections.length - 1}
                  onClick={() => moveSection(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground"
                  onClick={() =>
                    patch({
                      sections: content.sections.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Удалить раздел
                </Button>
              </span>
            </div>

            <FieldShell label="Заголовок раздела">
              <Input
                value={section.heading}
                onChange={(event) =>
                  patch({
                    sections: content.sections.map((item, i) =>
                      i === index
                        ? { ...item, heading: event.target.value }
                        : item,
                    ),
                  })
                }
              />
            </FieldShell>

            <FieldShell
              label="Текст раздела"
              hint="Каждая новая строка выводится отдельным абзацем."
            >
              <Textarea
                value={section.text}
                rows={5}
                className="resize-y"
                onChange={(event) =>
                  patch({
                    sections: content.sections.map((item, i) =>
                      i === index ? { ...item, text: event.target.value } : item,
                    ),
                  })
                }
              />
            </FieldShell>

            <ListInput
              label="Пункты списка (необязательно)"
              hint="Пункты выводятся списком с точками под текстом раздела."
              items={section.items}
              placeholder="Пункт списка"
              onChange={(items) =>
                patch({
                  sections: content.sections.map((item, i) =>
                    i === index ? { ...item, items } : item,
                  ),
                })
              }
            />
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            patch({
              sections: [
                ...content.sections,
                { heading: "", text: "", items: [] },
              ],
            })
          }
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Добавить раздел
        </Button>

        <div className="rounded-2xl border bg-card/50 p-5 sm:p-6 space-y-5">
          <p className="text-sm font-semibold">Контакты оператора</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <FieldShell label="Заголовок блока">
              <Input
                value={content.contactsHeading}
                onChange={(event) => patch({ contactsHeading: event.target.value })}
              />
            </FieldShell>
            <FieldShell label="Имя оператора">
              <Input
                value={content.contactsName}
                onChange={(event) => patch({ contactsName: event.target.value })}
              />
            </FieldShell>
            <FieldShell label="Телефон (как виден посетителям)">
              <Input
                value={content.contactsPhone}
                onChange={(event) => patch({ contactsPhone: event.target.value })}
              />
            </FieldShell>
            <FieldShell
              label="Ссылка для звонка"
              hint="Формат tel:+79056298708 — по ней телефон открывается в наборе номера."
            >
              <Input
                value={content.contactsPhoneHref}
                onChange={(event) =>
                  patch({ contactsPhoneHref: event.target.value })
                }
              />
            </FieldShell>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end lg:hidden">
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Сохранить
        </Button>
      </div>
    </div>
  );
}

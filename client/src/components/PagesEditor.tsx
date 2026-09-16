import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldShell, ListInput } from "@/components/EditorField";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { compressToWebpDataUrl } from "@/lib/imageCompress";
import {
  PAGE_BLOCK_HINTS,
  PAGE_BLOCK_LABELS,
  PAGE_BLOCK_TYPES,
  PAGE_LIMITS,
  PAGE_SLUG_PATTERN,
  RESERVED_SLUGS,
  newBlock,
  newPage,
  normalizeSlug,
  pagePath,
  sanitizePages,
  type PageBlock,
  type PageBlockType,
  type SitePage,
} from "@shared/pages";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";

/**
 * Адрес страницы: /p/<slug>. Ошибку показываем до сохранения — сервер
 * отбрасывает страницы с неподходящим адресом, и без подсказки было бы
 * непонятно, куда пропала страница.
 */
function slugError(page: SitePage): string {
  const slug = normalizeSlug(page.slug);
  if (!slug) return "Укажите адрес страницы (латиницей, например ceny).";
  if (!PAGE_SLUG_PATTERN.test(slug)) {
    return "Адрес — латиница в нижнем регистре, цифры и дефис: ceny, kak-my-rabotaem.";
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return `Адрес «${slug}» занят служебным разделом сайта — выберите другой.`;
  }
  return "";
}

/** Загрузка фото в блок страницы (тот же формат, что у фото первого экрана). */
function ImagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const upload = async (file: File) => {
    setError("");
    setUploading(true);
    try {
      const dataUrl = await compressToWebpDataUrl(file);
      const res = await apiRequest("PUT", "/api/admin/pages/image", { dataUrl });
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Сервер не вернул адрес фото");
      onChange(data.url);
      toast({
        title: "Фото загружено",
        description: "Не забудьте нажать «Сохранить».",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Не удалось загрузить фото";
      setError(message);
      toast({
        title: "Не удалось загрузить фото",
        description: message,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  /** Удалить загруженное фото со сервера, если оно наше (не внешняя ссылка). */
  const clear = async () => {
    const match = /^\/api\/content\/page-image\/([0-9a-f]{16})$/.exec(value);
    onChange("");
    if (!match) return;
    try {
      await apiRequest("DELETE", `/api/admin/pages/image/${match[1]}`);
    } catch {
      // Фото осталось в настройках — это не ошибка для админа
    }
  };

  return (
    <FieldShell label="Фото">
      {value ? (
        <img
          src={value}
          alt="Предпросмотр фото страницы"
          className="max-h-56 w-auto rounded-xl border"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="mr-1.5 h-4 w-4" />
          )}
          Загрузить фото
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => void clear()}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Убрать
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </FieldShell>
  );
}

/** Поля одного блока: набор зависит от типа блока. */
function BlockFields({
  block,
  onChange,
}: {
  block: PageBlock;
  onChange: (block: PageBlock) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <>
          <FieldShell label="Текст заголовка">
            <Input
              value={block.text}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </FieldShell>
          <FieldShell label="Размер" hint={PAGE_BLOCK_HINTS.heading}>
            <Select
              value={block.level}
              onValueChange={(level) => onChange({ ...block, level })}
            >
              <SelectTrigger className="w-full sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">Крупный</SelectItem>
                <SelectItem value="3">Помельче</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
        </>
      );
    case "text":
      return (
        <FieldShell label="Текст" hint={PAGE_BLOCK_HINTS.text}>
          <Textarea
            value={block.text}
            rows={6}
            className="resize-y"
            onChange={(event) => onChange({ ...block, text: event.target.value })}
          />
        </FieldShell>
      );
    case "list":
      return (
        <ListInput
          label="Пункты списка"
          hint={PAGE_BLOCK_HINTS.list}
          items={block.items}
          placeholder="Пункт списка"
          onChange={(items) => onChange({ ...block, items })}
        />
      );
    case "image":
      return (
        <>
          <ImagePicker
            value={block.url}
            onChange={(url) => onChange({ ...block, url })}
          />
          <FieldShell
            label="Адрес фото"
            hint="Заполняется загрузкой выше — можно вставить и внешнюю ссылку (https://…)."
          >
            <Input
              value={block.url}
              onChange={(event) => onChange({ ...block, url: event.target.value })}
            />
          </FieldShell>
          <FieldShell
            label="Alt-текст"
            hint="Опишите фото словами — это важно для поиска и для незрячих посетителей."
          >
            <Input
              value={block.alt}
              onChange={(event) => onChange({ ...block, alt: event.target.value })}
            />
          </FieldShell>
          <FieldShell label="Подпись под фото (необязательно)">
            <Input
              value={block.text}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </FieldShell>
        </>
      );
    case "button":
      return (
        <>
          <FieldShell label="Надпись на кнопке">
            <Input
              value={block.text}
              onChange={(event) => onChange({ ...block, text: event.target.value })}
            />
          </FieldShell>
          <FieldShell
            label="Ссылка"
            hint="Внутренняя (/p/ceny), телефон (tel:+79056298708), почта (mailto:…) или внешний сайт (https://…)."
          >
            <Input
              value={block.href}
              onChange={(event) => onChange({ ...block, href: event.target.value })}
            />
          </FieldShell>
        </>
      );
    default:
      return null;
  }
}

/**
 * Раздел «Страницы»: конструктор дополнительных страниц сайта.
 *
 * Порядок страниц в списке = порядок ссылок в меню и подвале. Страницы
 * открываются по адресу /p/<slug>, попадают в sitemap.xml и в HTML для
 * поисковиков (server/seo.ts) сразу после сохранения.
 */
export function PagesEditor() {
  const { toast } = useToast();
  const [pages, setPages] = useState<SitePage[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const baseJson = useRef("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await apiRequest("GET", "/api/admin/pages");
      const data = (await res.json()) as { pages?: unknown };
      const clean = sanitizePages(data.pages);
      setPages(clean);
      baseJson.current = JSON.stringify(clean);
      setActiveIndex((prev) =>
        clean.length === 0 ? 0 : Math.min(prev, clean.length - 1),
      );
    } catch {
      setLoadError(
        "Не удалось загрузить страницы сайта. Проверьте подключение и попробуйте ещё раз.",
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

  if (!pages) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загружаем страницы сайта…
      </div>
    );
  }

  const dirty = JSON.stringify(pages) !== baseJson.current;
  const activePage = pages[activeIndex];

  const patchPage = (index: number, patch: Partial<SitePage>) => {
    setPages((prev) =>
      prev
        ? prev.map((page, i) => (i === index ? { ...page, ...patch } : page))
        : prev,
    );
  };

  const patchBlock = (blockIndex: number, block: PageBlock) => {
    const blocks = activePage.blocks.map((item, i) =>
      i === blockIndex ? block : item,
    );
    patchPage(activeIndex, { blocks });
  };

  const moveBlock = (blockIndex: number, direction: -1 | 1) => {
    const next = [...activePage.blocks];
    const target = blockIndex + direction;
    if (target < 0 || target >= next.length) return;
    [next[blockIndex], next[target]] = [next[target], next[blockIndex]];
    patchPage(activeIndex, { blocks: next });
  };

  const movePage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    setPages(next);
    setActiveIndex(target);
  };

  const addPage = () => {
    if (pages.length >= PAGE_LIMITS.maxPages) {
      toast({
        title: "Больше страниц не добавить",
        description: `Лимит — ${PAGE_LIMITS.maxPages} страниц.`,
        variant: "destructive",
      });
      return;
    }
    setPages([...pages, newPage()]);
    setActiveIndex(pages.length);
  };

  const removePage = (index: number) => {
    const page = pages[index];
    const label = page.title || page.slug || "без названия";
    if (!window.confirm(`Удалить страницу «${label}»? Действие необратимо.`)) {
      return;
    }
    const next = pages.filter((_, i) => i !== index);
    setPages(next);
    setActiveIndex(Math.max(0, Math.min(index, next.length - 1)));
  };

  const save = async () => {
    const broken = pages.find((page) => slugError(page));
    if (broken) {
      setActiveIndex(pages.indexOf(broken));
      toast({
        title: "Проверьте адрес страницы",
        description: slugError(broken),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/pages", { pages });
      const data = (await res.json()) as { pages?: unknown };
      const clean = sanitizePages(data.pages);
      setPages(clean);
      baseJson.current = JSON.stringify(clean);
      setActiveIndex((prev) =>
        clean.length === 0 ? 0 : Math.min(prev, clean.length - 1),
      );
      toast({
        title: "Сохранено",
        description: "Страницы уже открываются на сайте, ссылки — в меню.",
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

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Страницы сайта</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Свои страницы для сайта: «Цены», «Акции», «Как мы работаем».
            Открываются по адресу <span className="font-mono">/p/адрес</span>,
            ссылки — в меню и подвале, страницы попадают в карту сайта.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Есть несохранённые изменения
            </span>
          )}
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

      <div className="grid lg:grid-cols-[300px_1fr] gap-8 items-start">
        {/* Список страниц */}
        <nav className="space-y-2">
          {pages.length === 0 && (
            <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
              Пока своих страниц нет. Добавьте первую — например «Цены».
            </p>
          )}

          {pages.map((page, index) => {
            const isActive = index === activeIndex;
            const error = slugError(page);
            return (
              <div
                key={index}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${
                  isActive
                    ? "border-primary/30 bg-primary/10"
                    : "border-transparent hover:bg-muted"
                }`}
              >
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setActiveIndex(index)}
                >
                  <span className="block text-sm font-semibold truncate">
                    {page.title || "Без заголовка"}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                    {page.slug ? pagePath(page.slug) : "/p/…"}
                  </span>
                </button>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {!page.visible && (
                    <Badge variant="secondary" className="text-[10px]">
                      скрыта
                    </Badge>
                  )}
                  {page.showInMenu && (
                    <Badge variant="secondary" className="text-[10px]">
                      в меню
                    </Badge>
                  )}
                  {error && (
                    <Badge className="border-destructive/40 bg-destructive/15 text-[10px] text-destructive">
                      адрес
                    </Badge>
                  )}
                  <span className="ml-auto flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Выше"
                      disabled={index === 0}
                      onClick={() => movePage(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Ниже"
                      disabled={index === pages.length - 1}
                      onClick={() => movePage(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      title="Удалить страницу"
                      onClick={() => removePage(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>
              </div>
            );
          })}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={addPage}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Добавить страницу
          </Button>
        </nav>

        {/* Редактор активной страницы */}
        <div className="space-y-6">
          {!activePage ? (
            <div className="rounded-2xl border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
              Выберите страницу слева или добавьте новую.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border bg-card/50 p-5 sm:p-6 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <FieldShell
                    label="Адрес страницы (латиницей)"
                    hint="Адрес будет /p/… — менять его после публикации не стоит: старая ссылка перестанет работать."
                  >
                    <Input
                      value={activePage.slug}
                      placeholder="ceny"
                      onChange={(event) =>
                        patchPage(activeIndex, { slug: event.target.value })
                      }
                    />
                  </FieldShell>
                  <FieldShell
                    label="Заголовок страницы (H1)"
                    hint="Крупный заголовок на странице — как «Цены на установку домофонов»."
                  >
                    <Input
                      value={activePage.title}
                      onChange={(event) =>
                        patchPage(activeIndex, { title: event.target.value })
                      }
                    />
                  </FieldShell>
                </div>

                {slugError(activePage) && (
                  <p className="flex items-start gap-2 text-sm text-destructive">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {slugError(activePage)}
                  </p>
                )}

                <div className="grid gap-5 sm:grid-cols-2">
                  <FieldShell
                    label="Название ссылки в меню"
                    hint="Пусто — возьмётся заголовок страницы."
                  >
                    <Input
                      value={activePage.menuLabel}
                      onChange={(event) =>
                        patchPage(activeIndex, { menuLabel: event.target.value })
                      }
                    />
                  </FieldShell>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                      <div>
                        <Label className="text-sm font-medium">
                          Показывать посетителям
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Скрытая страница доступна только из админки.
                        </p>
                      </div>
                      <Switch
                        checked={activePage.visible}
                        onCheckedChange={(visible) =>
                          patchPage(activeIndex, { visible })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
                      <div>
                        <Label className="text-sm font-medium">
                          Ссылка в меню и подвале
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Нужна, чтобы посетители и поисковики нашли страницу.
                        </p>
                      </div>
                      <Switch
                        checked={activePage.showInMenu}
                        onCheckedChange={(showInMenu) =>
                          patchPage(activeIndex, { showInMenu })
                        }
                      />
                    </div>
                  </div>
                </div>

                <FieldShell
                  label="Заголовок для поисковой выдачи (title)"
                  hint="Пусто — возьмётся заголовок страницы. До 60–70 символов."
                >
                  <Input
                    value={activePage.seoTitle}
                    onChange={(event) =>
                      patchPage(activeIndex, { seoTitle: event.target.value })
                    }
                  />
                </FieldShell>

                <FieldShell
                  label="Описание для поисковой выдачи"
                  hint="До ~160 символов. Именно этот текст Яндекс показывает под ссылкой."
                >
                  <Textarea
                    value={activePage.seoDescription}
                    rows={3}
                    className="resize-y"
                    onChange={(event) =>
                      patchPage(activeIndex, {
                        seoDescription: event.target.value,
                      })
                    }
                  />
                </FieldShell>

                {activePage.slug && (
                  <p className="flex flex-wrap items-center gap-3 text-sm">
                    <Link
                      href={pagePath(normalizeSlug(activePage.slug))}
                      className="inline-flex items-center gap-1.5 text-primary hover:underline"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Открыть страницу на сайте
                    </Link>
                    {dirty && (
                      <span className="text-xs text-muted-foreground">
                        (сначала сохраните изменения)
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Блоки страницы */}
              <div className="space-y-4">
                {activePage.blocks.map((block, index) => (
                  <div
                    key={index}
                    className="rounded-2xl border bg-card/40 p-5 space-y-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {PAGE_BLOCK_LABELS[block.type]} · {index + 1}
                      </span>
                      <span className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Выше"
                          disabled={index === 0}
                          onClick={() => moveBlock(index, -1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Ниже"
                          disabled={index === activePage.blocks.length - 1}
                          onClick={() => moveBlock(index, 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground"
                          onClick={() =>
                            patchPage(activeIndex, {
                              blocks: activePage.blocks.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Удалить
                        </Button>
                      </span>
                    </div>
                    <BlockFields
                      block={block}
                      onChange={(next) => patchBlock(index, next)}
                    />
                  </div>
                ))}

                <div className="rounded-2xl border border-dashed p-5">
                  <p className="mb-3 text-sm font-medium">Добавить блок</p>
                  <div className="flex flex-wrap gap-2">
                    {PAGE_BLOCK_TYPES.map((type: PageBlockType) => (
                      <Button
                        key={type}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={activePage.blocks.length >= PAGE_LIMITS.maxBlocks}
                        onClick={() =>
                          patchPage(activeIndex, {
                            blocks: [...activePage.blocks, newBlock(type)],
                          })
                        }
                      >
                        <Plus className="mr-1.5 h-4 w-4" />
                        {PAGE_BLOCK_LABELS[type]}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end lg:hidden">
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

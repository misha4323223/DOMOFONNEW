import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  cloneContent,
  DEFAULT_CONTENT,
  HOME_SECTIONS,
  sanitizeContent,
  type HomeContent,
} from "@shared/content";
import {
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import heroDesktopDefault from "../../image/hero-desktop.webp";
import heroMobileDefault from "../../image/hero-mobile.webp";

type SectionKey = keyof HomeContent;

/** Заменить в пути индексы массивов на «*» — по такому ключу ищем подписи полей. */
function wildPath(path: readonly string[]): string {
  return path.map((p) => (p === "" || /^\d+$/.test(p) ? "*" : p)).join(".");
}

function lastSegment(path: readonly string[]): string {
  return path[path.length - 1] ?? "";
}

/** Красивый заголовок по-русски, если подпись поля не задана явно. */
function prettifyKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// --- Человеческие подписи полей. Ключ — путь с «*» вместо индексов массива. ---
const FIELD_LABELS: Record<string, string> = {
  "seo.brandName": "Название бренда",
  "seo.title": "Заголовок страницы (title)",
  "seo.description": "Описание страницы (meta description)",
  "seo.keywords": "Ключевые слова (через запятую)",

  "header.logoTitle": "Название в шапке (логотип)",
  "header.logoSubtitle": "Подпись под названием",
  "header.ctaText": "Текст кнопки «Оставить заявку»",
  "header.nav": "Пункты меню в шапке",
  "header.nav.*.label": "Текст пункта",
  "header.nav.*.href": "Ссылка (якорь секции)",

  "hero.desktopImage": "Фото первого экрана (компьютер)",
  "hero.mobileImage": "Фото первого экрана (телефон)",
  "hero.altText": "Alt-текст фото (для поисковиков)",
  "hero.requestButtonText": "Кнопка «Оставить заявку»",
  "hero.servicesButtonText": "Кнопка «Наши услуги»",

  "services.title": "Заголовок блока",
  "services.subtitle": "Подзаголовок",
  "services.items": "Карточки услуг",
  "services.items.*.title": "Название услуги",
  "services.items.*.description": "Описание услуги",
  "services.items.*.features": "Пункты списка услуги",

  "benefits.title": "Заголовок блока",
  "benefits.subtitle": "Подзаголовок",
  "benefits.items": "Преимущества",
  "benefits.items.*.title": "Заголовок преимущества",
  "benefits.items.*.description": "Описание преимущества",

  "coverage.mode": "Режим показа блока",
  "coverage.title": "Заголовок блока",
  "coverage.subtitle": "Подзаголовок",
  "coverage.cities": "Города работы",
  "coverage.cities.*.name": "Название города",
  "coverage.cities.*.note": "Что делаем в городе",
  "coverage.morePrefix": "Текст перед телефоном",
  "coverage.phoneLabel": "Телефон (как виден посетителям)",
  "coverage.phoneHref": "Телефон (ссылка tel:)",

  "form.title": "Заголовок формы",
  "form.subtitle": "Подзаголовок",
  "form.nameLabel": "Подпись поля «Имя»",
  "form.namePlaceholder": "Подсказка в поле «Имя»",
  "form.phoneLabel": "Подпись поля «Телефон»",
  "form.phonePlaceholder": "Подсказка в поле «Телефон»",
  "form.serviceLabel": "Подпись поля «Тип заявки»",
  "form.servicePlaceholder": "Подсказка в поле «Тип заявки»",
  "form.addressLabel": "Подпись поля «Адрес»",
  "form.addressPlaceholder": "Подсказка в поле «Адрес»",
  "form.commentLabel": "Подпись поля «Комментарий»",
  "form.commentPlaceholder": "Подсказка в поле «Комментарий»",
  "form.consentText": "Текст согласия на обработку данных",
  "form.privacyLinkText": "Текст ссылки на политику",
  "form.callUsPrefix": "Текст «Или позвоните напрямую»",
  "form.phoneValue": "Телефон под формой (как виден)",
  "form.phoneHref": "Телефон под формой (ссылка tel:)",
  "form.serviceOptions": "Варианты услуг в выпадающем списке",
  "form.serviceOptions.*.value": "Код услуги",
  "form.serviceOptions.*.label": "Название услуги",
  "form.submitLabel": "Кнопка «Отправить заявку»",
  "form.submittingLabel": "Кнопка «Отправляем…»",
  "form.successTitle": "Заголовок «Заявка принята»",
  "form.successDescription": "Текст «Заявка принята»",
  "form.successToastTitle": "Заголовок уведомления об успехе",
  "form.toastDescription": "Текст уведомления об успехе",

  "contact.title": "Заголовок блока",
  "contact.subtitle": "Подзаголовок",
  "contact.items": "Карточки контактов",
  "contact.items.*.title": "Название (Телефон, Режим работы…)",
  "contact.items.*.value": "Значение",
  "contact.items.*.href": "Ссылка (tel:, mailto: или пусто)",

  "footer.companyTitle": "Название компании в подвале",
  "footer.companyDescription": "Описание компании в подвале",
  "footer.servicesTitle": "Заголовок колонки «Услуги»",
  "footer.servicesLinks": "Ссылки колонки «Услуги»",
  "footer.contactsTitle": "Заголовок колонки «Контакты»",
  "footer.contactsLinks": "Ссылки колонки «Контакты»",
  "footer.copyrightText": "Текст копирайта",
  "footer.developedByText": "Слова «Разработано в»",
  "footer.studioName": "Название студии",
  "footer.studioHref": "Ссылка на студию",
  "footer.requisites": "Реквизиты ИП",
  "footer.privacyText": "Текст ссылки на политику",
  "footer.privacyHref": "Адрес страницы политики",
};

const FIELD_HINTS: Record<string, string> = {
  "seo.title":
    "Именно это видят в поисковой выдаче. Рекомендуется до 60–70 символов, название «Обзор71» — в начале.",
  "seo.description":
    "Короткое описание для выдачи, до ~160 символов. Слова «Обзор71», «домофоны» и города помогут поиску.",
  "seo.keywords": "Необязательно, но можно перечислить ключевые запросы через запятую.",
  "header.nav.*.href": "Якорь секции, например #services или #contact.",
  "header.nav": "Пункты появляются и в десктопном, и в мобильном меню.",
  "hero.altText": "Опишите фото: поисковики и скринридеры читают этот текст.",
  "services.items.*.features": "Пункты выводятся списком с точками. Пустые пункты при сохранении удаляются.",
  "coverage.mode":
    "visible — блок виден посетителям; seo-only — скрыт визуально, но остаётся в HTML для поисковиков (сейчас так); hidden — убран со страницы полностью.",
  "coverage.cities": "Города и районы, где вы работаете. Важно для поиска по гео-запросам.",
  "form.serviceOptions.*.value":
    "Код услуги, по которому сохраняются заявки. Менять код у существующих вариантов нельзя — только добавлять новые.",
  "form.phoneHref": "Ссылка для звонка, например tel:+79056298708.",
  "contact.items.*.href": "Пусто — значение выведется текстом без ссылки.",
  "footer.copyrightText": "Можно использовать {year} — вместо него подставится текущий год.",
  "footer.servicesLinks": "Внутренние страницы (/privacy) открываются без перезагрузки, якоря #… — плавным скроллом.",
};

/** Поля, которые удобнее редактировать многострочно. Ключ — путь с «*». */
const TEXTAREA_PATHS = new Set<string>([
  "seo.description",
  "seo.keywords",
  "services.subtitle",
  "services.items.*.description",
  "benefits.subtitle",
  "benefits.items.*.description",
  "coverage.subtitle",
  "coverage.morePrefix",
  "coverage.cities.*.note",
  "form.subtitle",
  "form.commentPlaceholder",
  "form.successDescription",
  "form.toastDescription",
  "footer.companyDescription",
]);

function isTextarea(wild: string): boolean {
  return TEXTAREA_PATHS.has(wild);
}

const COVERAGE_MODE_OPTIONS = [
  { value: "visible", label: "Показывать посетителям" },
  { value: "seo-only", label: "Только для поисковиков (сейчас так)" },
  { value: "hidden", label: "Скрыть полностью" },
] as const;

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  "coverage.mode": [...COVERAGE_MODE_OPTIONS],
};

// --- Работа с вложенными путями (неизменяемо) ---
function getByPath(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function updateAt(
  root: unknown,
  path: readonly string[],
  value: unknown,
): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const next = [...root];
    const index = Number(head);
    next[index] = updateAt(next[index], rest, value);
    return next;
  }
  return {
    ...(root as Record<string, unknown>),
    [head]: updateAt((root as Record<string, unknown>)[head], rest, value),
  };
}

// --- Сжатие загруженного фото в webp до ~370 КБ (лимит записи YDB ~400 КБ) ---
const MAX_IMAGE_LENGTH = 370_000;

async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    image.src = url;
  });
}

async function compressToWebpDataUrl(file: File): Promise<string> {
  const source = await fileToImage(file);
  const maxSide = 1920;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  let width = Math.max(1, Math.round(source.width * scale));
  let height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не поддерживает сжатие фото");

  let dataUrl = "";
  // Крутим цикл: сначала снижаем качество webp, затем уменьшаем само фото.
  outer: for (let attempt = 0; attempt < 20; attempt++) {
    canvas.width = width;
    canvas.height = height;
    context.drawImage(source, 0, 0, width, height);
    for (let quality = 0.85; quality >= 0.4; quality -= 0.12) {
      dataUrl = canvas.toDataURL("image/webp", quality);
      if (dataUrl.length <= MAX_IMAGE_LENGTH) break outer;
    }
    width = Math.max(1, Math.round(width * 0.8));
    height = Math.max(1, Math.round(height * 0.8));
  }
  if (!dataUrl) throw new Error("Не удалось сжать фото");
  return dataUrl;
}

// --- Примитивы редактора ---
function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium leading-snug">{label}</Label>
      {children}
      {hint && (
        <p className="text-xs text-muted-foreground/90 leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
}

function StringField({
  value,
  path,
  onChange,
}: {
  value: string;
  path: string[];
  onChange: (path: string[], value: unknown) => void;
}) {
  const wild = wildPath(path);
  const area = isTextarea(wild);
  const select = SELECT_OPTIONS[wild];
  const hint = FIELD_HINTS[wild];
  const label = FIELD_LABELS[wild] ?? prettifyKey(lastSegment(path));

  if (select) {
    return (
      <FieldShell label={label} hint={hint}>
        <Select value={value} onValueChange={(v) => onChange(path, v)}>
          <SelectTrigger className="w-full sm:max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {select.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>
    );
  }

  return (
    <FieldShell label={label} hint={hint}>
      {area ? (
        <Textarea
          value={value}
          rows={wild.endsWith("description") ? 4 : 3}
          onChange={(event) => onChange(path, event.target.value)}
          className="resize-y"
        />
      ) : (
        <Input
          value={value}
          onChange={(event) => onChange(path, event.target.value)}
        />
      )}
    </FieldShell>
  );
}

function ImageField({
  label,
  hint,
  value,
  imageKey,
  defaultSrc,
  onUploaded,
  onCleared,
}: {
  label: string;
  hint?: string;
  value: string;
  imageKey: string;
  defaultSrc: string;
  onUploaded: (value: string) => void;
  onCleared: () => void;
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
      const res = await apiRequest("PUT", "/api/admin/content/image", {
        key: imageKey,
        dataUrl,
      });
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error("Сервер не вернул адрес фото");
      onUploaded(data.url);
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

  const src = value || defaultSrc;
  const isDefault = !value;

  return (
    <div className="space-y-2">
      <FieldShell label={label} hint={hint}>
        <div className="rounded-xl border bg-muted/30 overflow-hidden max-w-md">
          <div className="relative aspect-[16/10] bg-black/5">
            <img
              src={src}
              alt="Предпросмотр первого экрана"
              className="h-full w-full object-cover"
            />
            {isDefault && (
              <span className="absolute bottom-2 left-2 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                Стандартное фото из сборки
              </span>
            )}
          </div>
        </div>
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
            Загрузить своё фото
          </Button>
          {!isDefault && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  await apiRequest(
                    "DELETE",
                    `/api/admin/content/image/${imageKey}`,
                  );
                  onCleared();
                } catch {
                  toast({
                    title: "Не удалось удалить фото",
                    variant: "destructive",
                  });
                }
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Убрать своё фото
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
    </div>
  );
}

const HERO_IMAGE_KEYS: Record<string, { imageKey: string; defaultSrc: string }> =
  {
    "hero.desktopImage": {
      imageKey: "hero-desktop",
      defaultSrc: heroDesktopDefault,
    },
    "hero.mobileImage": {
      imageKey: "hero-mobile",
      defaultSrc: heroMobileDefault,
    },
  };

function StringListField({
  items,
  path,
  onChange,
}: {
  items: string[];
  path: string[];
  onChange: (path: string[], value: unknown) => void;
}) {
  const wild = wildPath(path);
  const label = FIELD_LABELS[wild] ?? prettifyKey(lastSegment(path));
  const hint = FIELD_HINTS[wild];

  const setItem = (index: number, value: string) =>
    onChange(path, items.map((item, i) => (i === index ? value : item)));
  const removeItem = (index: number) =>
    onChange(path, items.filter((_, i) => i !== index));

  return (
    <FieldShell label={label} hint={hint}>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={item}
              placeholder="Текст пункта"
              onChange={(event) => setItem(index, event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => removeItem(index)}
              title="Удалить пункт"
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(path, [...items, ""])}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Добавить пункт
        </Button>
      </div>
    </FieldShell>
  );
}

function ObjectArrayField({
  items,
  path,
  onChange,
}: {
  items: unknown[];
  path: string[];
  onChange: (path: string[], value: unknown) => void;
}) {
  const wild = wildPath(path);
  const label = FIELD_LABELS[wild] ?? prettifyKey(lastSegment(path));
  const hint = FIELD_HINTS[wild];

  const removeItem = (index: number) =>
    onChange(path, items.filter((_, i) => i !== index));

  return (
    <FieldShell label={label} hint={hint}>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={index}
            className="rounded-xl border bg-card/40 p-4 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label} · {index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-muted-foreground"
                onClick={() => removeItem(index)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Удалить
              </Button>
            </div>
            <NodeField
              value={item}
              path={[...path, String(index)]}
              onChange={onChange}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const template = getByPath(DEFAULT_CONTENT, path);
            const sample = Array.isArray(template) ? template[0] : undefined;
            const fresh = sample !== undefined ? cloneContent(sample) : {};
            onChange(path, [...items, fresh]);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Добавить
        </Button>
      </div>
    </FieldShell>
  );
}

/**
 * Универсальный редактор узла контента. Рекурсивно обходит структуру
 * DEFAULT_CONTENT, поэтому любое поле секции редактируется автоматически:
 *  — строка    → поле ввода / выпадающий список / многострочный текст;
 *  — массив    → список пунктов (строки) или карточки (объекты);
 *  — объект    → набор вложенных полей.
 */
function NodeField({
  value,
  path,
  onChange,
}: {
  value: unknown;
  path: string[];
  onChange: (path: string[], value: unknown) => void;
}) {
  const wild = wildPath(path);
  const heroImage = HERO_IMAGE_KEYS[wild];

  if (heroImage) {
    return (
      <ImageField
        label={FIELD_LABELS[wild] ?? prettifyKey(lastSegment(path))}
        hint={FIELD_HINTS[wild]}
        value={typeof value === "string" ? value : ""}
        imageKey={heroImage.imageKey}
        defaultSrc={heroImage.defaultSrc}
        onUploaded={(url) => onChange(path, url)}
        onCleared={() => onChange(path, "")}
      />
    );
  }

  if (typeof value === "string") {
    return (
      <StringField value={value} path={path} onChange={onChange} />
    );
  }

  if (Array.isArray(value)) {
    const template = getByPath(DEFAULT_CONTENT, path);
    const isStringArray =
      Array.isArray(template) && typeof template[0] === "string";
    if (isStringArray) {
      return (
        <StringListField
          items={value as string[]}
          path={path}
          onChange={onChange}
        />
      );
    }
    return (
      <ObjectArrayField items={value} path={path} onChange={onChange} />
    );
  }

  if (value && typeof value === "object") {
    const template = getByPath(DEFAULT_CONTENT, path);
    const keys =
      template && typeof template === "object"
        ? Object.keys(template as Record<string, unknown>)
        : [];
    if (keys.length === 0) return null;
    return (
      <div className="space-y-4">
        {keys.map((key) => (
          <NodeField
            key={key}
            value={(value as Record<string, unknown>)[key]}
            path={[...path, key]}
            onChange={onChange}
          />
        ))}
      </div>
    );
  }

  return null;
}

// --- Основной компонент: список секций + редактор активной секции ---
export function ContentEditor() {
  const { toast } = useToast();
  const [content, setContent] = useState<HomeContent | null>(null);
  const [loadError, setLoadError] = useState("");
  const [activeKey, setActiveKey] = useState<SectionKey>("seo");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const baseJson = useRef("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/content", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        content?: unknown;
        updatedAt?: string | null;
      };
      const clean = sanitizeContent(data.content ?? {});
      setContent(clean);
      baseJson.current = JSON.stringify(clean);
      setSavedAt(data.updatedAt ?? null);
    } catch {
      setLoadError(
        "Не удалось загрузить содержимое сайта. Проверьте подключение и попробуйте ещё раз.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeSection =
    HOME_SECTIONS.find((section) => section.key === activeKey) ??
    HOME_SECTIONS[0];

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
        Загружаем содержимое сайта…
      </div>
    );
  }

  const dirty = JSON.stringify(content) !== baseJson.current;

  const patch = (path: string[], value: unknown) => {
    setContent((prev) =>
      prev ? (updateAt(prev, path, value) as HomeContent) : prev,
    );
  };

  const resetSection = (key: SectionKey) => {
    const label =
      HOME_SECTIONS.find((section) => section.key === key)?.title ?? key;
    const confirmed = window.confirm(
      `Вернуть секцию «${label}» к значениям по умолчанию? Текущие правки этой секции будут потеряны.`,
    );
    if (!confirmed) return;
    patch([key], cloneContent(getByPath(DEFAULT_CONTENT, [key])));
  };

  const save = async () => {
    if (!content) return;
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/admin/content", { content });
      const data = (await res.json()) as {
        content?: unknown;
        updatedAt?: string;
      };
      const clean = sanitizeContent(data.content ?? content);
      setContent(clean);
      baseJson.current = JSON.stringify(clean);
      setSavedAt(data.updatedAt ?? new Date().toISOString());
      toast({
        title: "Сохранено",
        description: "Изменения уже видны на сайте.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Попробуйте ещё раз";
      toast({
        title: "Не удалось сохранить",
        description: message,
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
          <h2 className="text-2xl font-bold">Содержимое главной страницы</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Правки применяются к сайту сразу после нажатия «Сохранить».
            {savedAt && (
              <span className="ml-2 text-xs">
                Последнее сохранение:{" "}
                {new Date(savedAt).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
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

      <div className="grid lg:grid-cols-[280px_1fr] gap-8 items-start">
        {/* Список секций */}
        <nav className="lg:sticky lg:top-20 space-y-1">
          {HOME_SECTIONS.map((section) => {
            const isActive = section.key === activeKey;
            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveKey(section.key)}
                className={`w-full text-left rounded-lg px-4 py-3 transition-colors border ${
                  isActive
                    ? "bg-primary/10 border-primary/30 text-foreground"
                    : "border-transparent hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {section.title}
                </span>
                <span
                  className={`mt-0.5 block text-xs leading-snug ${
                    isActive ? "text-muted-foreground" : "text-muted-foreground/70"
                  }`}
                >
                  {section.description}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Редактор активной секции */}
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-bold">{activeSection.title}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {activeSection.description}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              onClick={() => resetSection(activeSection.key)}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" />
              Сбросить секцию
            </Button>
          </div>

          <div className="rounded-2xl border bg-card/50 p-5 sm:p-6 space-y-6">
            <NodeField
              value={getByPath(content, [activeSection.key])}
              path={[activeSection.key]}
              onChange={patch}
            />
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
        </div>
      </div>
    </div>
  );
}

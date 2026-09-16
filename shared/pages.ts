/**
 * Дополнительные страницы сайта: то, что админ создаёт сам из админки
 * («Цены», «Акции», «Как мы работаем» и т.п.).
 *
 * Раньше адреса страниц были зашиты в код (`/`, `/privacy`, `/admin`), поэтому
 * новую страницу можно было добавить только правкой кода и деплоем. Теперь
 * страницы живут в настройках сайта (одним JSON-документом), собираются из
 * блоков и открываются по адресу `/p/<slug>`.
 *
 * Здесь:
 *  - типы страницы и блоков,
 *  - PAGE_BLOCK_LABELS / newBlock — для редактора в админке,
 *  - sanitizePages() — очистка произвольных данных из админки (используется
 *    сервером при сохранении и чтении).
 *
 * Тот же документ читает и SEO-пререндер сервера (server/seo.ts), поэтому
 * новые страницы попадают в HTML для поисковиков, а не только в SPA.
 */

/** Ограничения, чтобы в базу не попали гигантские или вредные значения. */
export const PAGE_LIMITS = {
  maxPages: 20,
  maxBlocks: 40,
  maxListItems: 30,
  maxTextLength: 5000,
  maxShortLength: 200,
  maxUrlLength: 500,
} as const;

/** Адрес страницы: латиница в нижнем регистре, цифры и дефис. */
export const PAGE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Адреса, которые уже заняты служебными разделами сайта. */
export const RESERVED_SLUGS = ["admin", "privacy", "api", "p"];

export const PAGE_BLOCK_TYPES = [
  "heading",
  "text",
  "list",
  "image",
  "button",
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];

/** Человеческие названия блоков — для редактора в админке. */
export const PAGE_BLOCK_LABELS: Record<PageBlockType, string> = {
  heading: "Заголовок",
  text: "Текст",
  list: "Список",
  image: "Фото",
  button: "Кнопка со ссылкой",
};

/** Короткие подсказки под полями блока в редакторе. */
export const PAGE_BLOCK_HINTS: Record<PageBlockType, string> = {
  heading: "Промежуточный заголовок внутри страницы. Два уровня: крупный и помельче.",
  text: "Обычный текст. Каждая новая строка выводится отдельным абзацем.",
  list: "Список с точками. Один пункт — одна строка.",
  image: "Фото загружается с телефона или компьютера, alt-текст важен для поиска.",
  button:
    "Надпись и ссылка: на другую страницу сайта, в телефон или на внешний сайт. Без корректной ссылки кнопка на странице не появится.",
};

/**
 * Блок страницы. Поля плоские (все сразу), а не разные для каждого типа —
 * так их проще и редактировать в списке, и проверять на сервере: лишние для
 * типа поля просто не выводятся.
 */
export interface PageBlock {
  type: PageBlockType;
  /** heading — текст заголовка; text — абзацы; image — подпись; button — надпись кнопки. */
  text: string;
  /** heading — уровень заголовка: "2" или "3". */
  level: string;
  /** list — пункты списка. */
  items: string[];
  /** image — адрес фото (наша загрузка или внешний URL). */
  url: string;
  /** image — alt-текст. */
  alt: string;
  /** button — адрес ссылки. */
  href: string;
}

export interface SitePage {
  /** Адрес страницы: сайт отвечает на /p/<slug>. */
  slug: string;
  /** Заголовок H1 на странице. */
  title: string;
  /** Текст ссылки в меню (пусто — берётся заголовок). */
  menuLabel: string;
  /** Заголовок для поисковой выдачи (пусто — берётся заголовок). */
  seoTitle: string;
  /** Описание для поисковой выдачи. */
  seoDescription: string;
  /** Показывать страницу посетителям (скрытая доступна только из админки). */
  visible: boolean;
  /** Показывать ссылку в меню сайта и в подвале. */
  showInMenu: boolean;
  blocks: PageBlock[];
}

/** Новый пустой блок нужного типа — для кнопки «Добавить блок». */
export function newBlock(type: PageBlockType): PageBlock {
  return {
    type,
    text: "",
    level: "2",
    items: type === "list" ? [""] : [],
    url: "",
    alt: "",
    href: "",
  };
}

/** Новая страница с заготовкой заголовка и первого блока. */
export function newPage(slug = ""): SitePage {
  return {
    slug,
    title: "",
    menuLabel: "",
    seoTitle: "",
    seoDescription: "",
    visible: true,
    showInMenu: false,
    blocks: [newBlock("heading"), newBlock("text")],
  };
}

/** Адрес страницы на сайте: /p/price. */
export function pagePath(slug: string): string {
  return `/p/${slug}`;
}

/** Заголовок для поисковой выдачи: свой, иначе — заголовок страницы. */
export function pageSeoTitle(page: SitePage): string {
  return page.seoTitle.trim() || page.title.trim();
}

/** Текст ссылки в меню: свой, иначе — заголовок страницы. */
export function pageMenuLabel(page: SitePage): string {
  return page.menuLabel.trim() || page.title.trim();
}

/**
 * Приводит адрес к допустимому виду: нижний регистр, пробелы и подчёркивания —
 * дефис, русские буквы недопустимы (адрес должен быть латиницей).
 */
export function normalizeSlug(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+$/g, "");
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Безопасный адрес ссылки или фото: пусто, относительный путь сайта,
 * http(s), tel: или mailto:. Всё остальное (например, javascript:) отбрасываем.
 */
export function safeUrl(value: unknown): string {
  const raw = str(value, PAGE_LIMITS.maxUrlLength).trim().replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^(tel|mailto):/i.test(raw)) return raw;
  return "";
}

function sanitizeBlock(input: unknown): PageBlock | null {
  if (!isRecord(input)) return null;
  const type = input.type;
  if (typeof type !== "string" || !(PAGE_BLOCK_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  const blockType = type as PageBlockType;
  const items: string[] = [];
  if (blockType === "list" && Array.isArray(input.items)) {
    for (const item of input.items.slice(0, PAGE_LIMITS.maxListItems)) {
      const text = str(item, PAGE_LIMITS.maxShortLength).trim();
      if (text) items.push(text);
    }
  }
  const href = safeUrl(input.href);
  // Кнопка без корректной ссылки бессмысленна (и опасна, если админ вставил
  // что-то вроде javascript:) — такой блок не сохраняем.
  if (blockType === "button" && !href) return null;

  return {
    type: blockType,
    text: str(input.text, PAGE_LIMITS.maxTextLength),
    level: input.level === "3" ? "3" : "2",
    items,
    url: safeUrl(input.url),
    alt: str(input.alt, PAGE_LIMITS.maxShortLength),
    href,
  };
}

/**
 * Очистка списка страниц: неподходящие адреса и повторы отбрасываются,
 * «мусор» из тела запроса не попадает в базу. Пустой список — тоже
 * корректный результат (страниц нет).
 */
export function sanitizePages(input: unknown): SitePage[] {
  if (!Array.isArray(input)) return [];
  const pages: SitePage[] = [];
  const used = new Set<string>();

  for (const item of input.slice(0, PAGE_LIMITS.maxPages)) {
    if (!isRecord(item)) continue;
    const slug = normalizeSlug(item.slug);
    if (!slug || !PAGE_SLUG_PATTERN.test(slug)) continue;
    if (RESERVED_SLUGS.includes(slug) || used.has(slug)) continue;
    used.add(slug);

    const title = str(item.title, PAGE_LIMITS.maxShortLength).trim();
    const blocks: PageBlock[] = [];
    if (Array.isArray(item.blocks)) {
      for (const raw of item.blocks.slice(0, PAGE_LIMITS.maxBlocks)) {
        const block = sanitizeBlock(raw);
        // Пустые блоки без текста не сохраняем — иначе на странице появятся дыры.
        if (block && (block.text.trim() || block.items.length || block.url)) {
          blocks.push(block);
        }
      }
    }

    pages.push({
      slug,
      title: title || slug,
      menuLabel: str(item.menuLabel, PAGE_LIMITS.maxShortLength).trim(),
      seoTitle: str(item.seoTitle, PAGE_LIMITS.maxShortLength).trim(),
      seoDescription: str(item.seoDescription, 400).trim(),
      visible: item.visible !== false,
      showInMenu: item.showInMenu === true,
      blocks,
    });
  }

  return pages;
}

/** Страница по адресу (без учёта регистра и лишних дефисов). */
export function findPage(
  pages: SitePage[],
  slug: string,
): SitePage | undefined {
  const wanted = normalizeSlug(slug);
  if (!wanted) return undefined;
  return pages.find((page) => page.slug === wanted);
}

/** Страницы, которые видит посетитель (скрытые — только в админке). */
export function visiblePages(pages: SitePage[]): SitePage[] {
  return pages.filter((page) => page.visible);
}

/** Страницы, ссылки на которые показываем в меню и подвале. */
export function menuPages(pages: SitePage[]): SitePage[] {
  return pages.filter((page) => page.visible && page.showInMenu);
}

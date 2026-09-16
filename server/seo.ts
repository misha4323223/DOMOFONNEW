/**
 * SEO-пререндер главной страницы.
 *
 * Сайт — SPA: сервер отдаёт пустую оболочку, а весь текст рендерится
 * JavaScript'ом и подгружается с /api/content. YandexBot (и частично
 * Googlebot) приходят на страницу, видят пустой <div id="root"> и уходят —
 * индексировать нечего. Поэтому в выдаче сайта нет, а ИИ-ответы Яндекса
 * (Нейро, Алиса) его тоже «не видят»: они читают поисковый индекс.
 *
 * Решение — пререндер на сервере: при отдаче index.html вставляем в HTML
 * весь текстовый контент сайта (тот же, что рисует React, включая правки
 * из админки) и актуальные <title>/<meta description>. Бот получает
 * страницу с текстом с первого запроса, без выполнения JS.
 *
 * Блок скрыт от посетителей (sr-only), но текст в нём 1-в-1 повторяет
 * видимый контент — это стандартный приём пререндера, а не «скрытый
 * текст»: пользователь видит то же самое, что читает робот.
 *
 * Отзывы — отдельная история. Клиент грузит их запросом /api/reviews уже
 * после загрузки страницы, поэтому в HTML их не было вовсе. Здесь отзывы
 * (опубликованные в админке) превращаются в:
 *   1) текст в пререндер-блоке — чтобы попадали в индекс без JS,
 *   2) разметку schema.org Review + AggregateRating — по ней Яндекс может
 *      показать рейтинг в сниппете (Google звёзды для отзывов компании
 *      о самой себе не показывает, это его правило, а не наша ошибка).
 */
import { sanitizeContent, type HomeContent } from "@shared/content";
import {
  findPage,
  pagePath,
  pageSeoTitle,
  sanitizePages,
  type PageBlock,
  type SitePage,
} from "@shared/pages";
import { sanitizePrivacy, type PrivacyContent } from "@shared/privacy";
import { storage } from "./storage";
import type { Review } from "./ydb";

const CONTENT_SETTING_KEY = "content:home";
const PAGES_SETTING_KEY = "pages:site";
const PRIVACY_SETTING_KEY = "content:privacy";
/** Страницы и политика читаются с сайта — держим их в кэше недолго, чтобы
 * правки из админки были видны в HTML почти сразу. */
const SHORT_TTL_MS = 60 * 1000;
/** Контент меняется редко (правки из админки) — кэшируем на 5 минут. */
const CONTENT_TTL_MS = 5 * 60 * 1000;

/**
 * Сколько отзывов показываем в тексте пререндера. Столько же, сколько
 * выводит сайт (`published.slice(0, 6)`), — разметка должна совпадать
 * с тем, что видит посетитель.
 */
const SEO_REVIEWS_LIMIT = 6;
/** Отзывы публикуются в админке — кэш короткий, как и у /api/reviews. */
const REVIEWS_TTL_MS = 60 * 1000;

/** Экранирование текста для безопасной вставки в HTML-атрибуты и тело. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let contentCache: { content: HomeContent; at: number } | null = null;
let reviewsCache: { reviews: Review[]; at: number } | null = null;
let pagesCache: { pages: SitePage[]; at: number } | null = null;
let privacyCache: { privacy: PrivacyContent; at: number } | null = null;

/**
 * Читает контент сайта из БД (правки админки) с запасным вариантом —
 * значениями по умолчанию. Падение БД не должно ронять страницу.
 */
async function loadContent(): Promise<HomeContent> {
  if (contentCache && Date.now() - contentCache.at < CONTENT_TTL_MS) {
    return contentCache.content;
  }
  let overrides: unknown = {};
  try {
    const saved = await storage.getSetting(CONTENT_SETTING_KEY);
    if (saved) {
      try {
        overrides = JSON.parse(saved.value);
      } catch {
        // Битые данные — используем дефолты (как в /api/content)
      }
    }
  } catch (err) {
    console.error("Не удалось прочитать контент для SEO-пререндера:", err);
  }
  const content = sanitizeContent(overrides);
  contentCache = { content, at: Date.now() };
  return content;
}

/**
 * Читает опубликованные отзывы для пререндера. Падение БД не должно ронять
 * страницу: при ошибке считаем, что отзывов нет, и отдаём HTML без них.
 */
async function loadPublishedReviews(): Promise<Review[]> {
  if (reviewsCache && Date.now() - reviewsCache.at < REVIEWS_TTL_MS) {
    return reviewsCache.reviews;
  }
  let reviews: Review[] = [];
  try {
    reviews = await storage.listPublishedReviews();
  } catch (err) {
    console.error("Не удалось прочитать отзывы для SEO-пререндера:", err);
  }
  reviewsCache = { reviews, at: Date.now() };
  return reviews;
}

/**
 * Читает дополнительные страницы сайта из настроек (те же данные, что
 * отдаёт /api/pages). Нужны, чтобы новые страницы попадали в HTML без JS —
 * иначе Яндекс видел бы по /p/<slug> пустую оболочку.
 */
async function loadPages(): Promise<SitePage[]> {
  if (pagesCache && Date.now() - pagesCache.at < SHORT_TTL_MS) {
    return pagesCache.pages;
  }
  let overrides: unknown = [];
  try {
    const saved = await storage.getSetting(PAGES_SETTING_KEY);
    if (saved) {
      try {
        overrides = JSON.parse(saved.value);
      } catch {
        // Битые данные — считаем, что своих страниц нет (как в /api/pages)
      }
    }
  } catch (err) {
    console.error("Не удалось прочитать страницы сайта для SEO-пререндера:", err);
  }
  const pages = sanitizePages(overrides);
  pagesCache = { pages, at: Date.now() };
  return pages;
}

/**
 * Читает текст политики конфиденциальности. Падение БД не должно ронять
 * страницу: при ошибке остаются значения по умолчанию.
 */
async function loadPrivacy(): Promise<PrivacyContent> {
  if (privacyCache && Date.now() - privacyCache.at < SHORT_TTL_MS) {
    return privacyCache.privacy;
  }
  let overrides: unknown = {};
  try {
    const saved = await storage.getSetting(PRIVACY_SETTING_KEY);
    if (saved) {
      try {
        overrides = JSON.parse(saved.value);
      } catch {
        // Битые данные — используем текст по умолчанию
      }
    }
  } catch (err) {
    console.error("Не удалось прочитать политику для SEO-пререндера:", err);
  }
  const privacy = sanitizePrivacy(overrides);
  privacyCache = { privacy, at: Date.now() };
  return privacy;
}

/**
 * Склонение слова «отзыв» в родительном падеже — для фразы «на основе N …»
 * («на основе 1 отзыва», «на основе 5 отзывов»). То же правило на клиенте.
 */
function pluralReviews(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "отзыва";
  return "отзывов";
}

/** Средняя оценка опубликованных отзывов (0 — отзывов нет). */
function averageRating(reviews: Review[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
  return sum / reviews.length;
}

/** Дата отзыва в формате schema.org (YYYY-MM-DD). */
function reviewDate(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

/**
 * Собирает семантический HTML со всеми текстами сайта: заголовки, услуги,
 * преимущества, города, контакты, телефон, реквизиты.
 */
function buildSeoBlock(content: HomeContent): string {
  const { seo, services, benefits, coverage, form, contact, footer } = content;
  const parts: string[] = [];

  parts.push(`<h1>${esc(seo.brandName)} — ${esc(seo.title)}</h1>`);
  parts.push(`<p>${esc(seo.description)}</p>`);

  // Услуги
  parts.push(`<h2>${esc(services.title)}</h2>`);
  if (services.subtitle) parts.push(`<p>${esc(services.subtitle)}</p>`);
  parts.push("<ul>");
  for (const item of services.items) {
    parts.push("<li>");
    parts.push(`<h3>${esc(item.title)}</h3>`);
    if (item.description) parts.push(`<p>${esc(item.description)}</p>`);
    if (item.features?.length) {
      parts.push("<ul>");
      for (const f of item.features) parts.push(`<li>${esc(f)}</li>`);
      parts.push("</ul>");
    }
    parts.push("</li>");
  }
  parts.push("</ul>");

  // Преимущества
  parts.push(`<h2>${esc(benefits.title)}</h2>`);
  if (benefits.subtitle) parts.push(`<p>${esc(benefits.subtitle)}</p>`);
  parts.push("<ul>");
  for (const item of benefits.items) {
    parts.push(`<li><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p></li>`);
  }
  parts.push("</ul>");

  // Зона обслуживания
  parts.push(`<h2>${esc(coverage.title)}</h2>`);
  if (coverage.subtitle) parts.push(`<p>${esc(coverage.subtitle)}</p>`);
  parts.push("<ul>");
  for (const city of coverage.cities) {
    parts.push(`<li>${esc(city.name)}${city.note ? ` — ${esc(city.note)}` : ""}</li>`);
  }
  parts.push("</ul>");
  if (coverage.morePrefix) parts.push(`<p>${esc(coverage.morePrefix)}</p>`);

  // Контакты и телефон
  parts.push(`<h2>${esc(contact.title)}</h2>`);
  if (contact.subtitle) parts.push(`<p>${esc(contact.subtitle)}</p>`);
  parts.push("<ul>");
  for (const item of contact.items) {
    parts.push(
      `<li>${esc(item.title)}: ${item.href ? `<a href="${esc(item.href)}">${esc(item.value)}</a>` : esc(item.value)}</li>`,
    );
  }
  parts.push("</ul>");
  if (form.phoneValue) {
    const href = form.phoneHref || `tel:${form.phoneValue.replace(/[^+\d]/g, "")}`;
    parts.push(
      `<p>${esc(form.callUsPrefix || "Позвоните нам")}: <a href="${esc(href)}">${esc(form.phoneValue)}</a></p>`,
    );
  }

  // Реквизиты
  if (footer.requisites) parts.push(`<p>${esc(footer.requisites)}</p>`);

  return parts.join("\n");
}

/**
 * Отзывы в пререндер-блоке: заголовок блока, сводная оценка и сами отзывы
 * с ответами службы. Отзывов нет — раздела нет (пустой заголовок в индексе
 * хуже, чем его отсутствие).
 */
function buildReviewsBlock(content: HomeContent, reviews: Review[]): string {
  if (reviews.length === 0) return "";

  const average = averageRating(reviews);
  const parts: string[] = [];
  parts.push(`<h2>${esc(content.reviews.title)}</h2>`);
  // Запятая как разделитель дробей — так же, как показывает сайт.
  const averageText = average.toFixed(1).replace(".", ",");
  parts.push(
    `<p>Средняя оценка ${averageText} из 5 на основе ${reviews.length} ${pluralReviews(reviews.length)}.</p>`,
  );
  parts.push("<ul>");
  for (const review of reviews.slice(0, SEO_REVIEWS_LIMIT)) {
    const rating = Number(review.rating) || 0;
    parts.push("<li>");
    parts.push(`<p>Оценка ${rating} из 5</p>`);
    parts.push(`<p>${esc(review.text)}</p>`);
    const author = review.city ? `${review.name}, ${review.city}` : review.name;
    parts.push(`<p>${esc(author)}</p>`);
    if (review.reply?.trim()) {
      parts.push(`<p>Ответ службы: ${esc(review.reply)}</p>`);
    }
    parts.push("</li>");
  }
  parts.push("</ul>");
  return parts.join("\n");
}

/**
 * Разметка schema.org для отзывов: AggregateRating и Review внутри того же
 * узла LocalBusiness (ссылка по @id на блок из index.html).
 *
 * Отдельный <script> — потому что сводная оценка должна считаться из БД
 * на сервере, а статический блок в index.html править нельзя: его же
 * отдаёт Vite в режиме разработки.
 */
function buildReviewsJsonLd(reviews: Review[]): string {
  if (reviews.length === 0) return "";

  const average = averageRating(reviews);
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": "https://obzor71.ru/#business",
    name: "Домофонная служба ИП Бухтеев",
    url: "https://obzor71.ru/",
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: average.toFixed(1),
      reviewCount: reviews.length,
      bestRating: 5,
      worstRating: 1,
    },
    review: reviews.slice(0, SEO_REVIEWS_LIMIT).map((review) => ({
      "@type": "Review",
      author: { "@type": "Person", name: review.name },
      datePublished: reviewDate(review.createdAt),
      reviewBody: review.text,
      reviewRating: {
        "@type": "Rating",
        ratingValue: Number(review.rating) || 0,
        bestRating: 5,
        worstRating: 1,
      },
    })),
  };

  // Экранируем «<», иначе текст отзыва со «</script>» сломает страницу.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/** Абзацы текста: каждая непустая строка — отдельный абзац (как на сайте). */
function paragraphs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Ссылка для звонка из телефона, если админ её не задал отдельно. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}

/** Один блок страницы → HTML для поисковика (то же, что рисует React). */
function buildBlock(block: PageBlock): string {
  switch (block.type) {
    case "heading": {
      const tag = block.level === "3" ? "h3" : "h2";
      return block.text ? `<${tag}>${esc(block.text)}</${tag}>` : "";
    }
    case "text":
      return paragraphs(block.text)
        .map((line) => `<p>${esc(line)}</p>`)
        .join("\n");
    case "list":
      return block.items.length
        ? `<ul>${block.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
        : "";
    case "image":
      return block.url
        ? `<img src="${esc(block.url)}" alt="${esc(block.alt || block.text)}" />`
        : "";
    case "button":
      if (!block.text) return "";
      return block.href
        ? `<p><a href="${esc(block.href)}">${esc(block.text)}</a></p>`
        : `<p>${esc(block.text)}</p>`;
    default:
      return "";
  }
}

/**
 * Блок дополнительной страницы из админки: H1, содержимое блоков и телефон —
 * чтобы у страницы был контакт для местного поиска (как на главной).
 */
function buildPageBlock(
  page: SitePage,
  phone: string,
  phoneHref: string,
): string {
  const parts: string[] = [`<h1>${esc(page.title)}</h1>`];
  for (const block of page.blocks) {
    const html = buildBlock(block);
    if (html) parts.push(html);
  }
  if (phone) {
    parts.push(
      `<p>Записаться или задать вопрос: <a href="${esc(phoneHref || telHref(phone))}">${esc(phone)}</a></p>`,
    );
  }
  return parts.join("\n");
}

/** Блок страницы «Политика конфиденциальности» (текст правит админ). */
function buildPrivacyBlock(
  privacy: PrivacyContent,
  content: HomeContent,
): string {
  const parts: string[] = [`<h1>${esc(privacy.title)}</h1>`];
  if (privacy.updatedLabel) {
    parts.push(`<p>${esc(privacy.updatedLabel)}</p>`);
  }
  for (const section of privacy.sections) {
    if (section.heading) parts.push(`<h2>${esc(section.heading)}</h2>`);
    for (const line of paragraphs(section.text)) parts.push(`<p>${esc(line)}</p>`);
    if (section.items.length) {
      parts.push(`<ul>${section.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`);
    }
  }
  if (privacy.contactsHeading) {
    parts.push(`<h2>${esc(privacy.contactsHeading)}</h2>`);
  }
  if (privacy.contactsName) parts.push(`<p>${esc(privacy.contactsName)}</p>`);
  if (privacy.contactsPhone) {
    parts.push(
      `<p>Телефон: <a href="${esc(privacy.contactsPhoneHref || telHref(privacy.contactsPhone))}">${esc(privacy.contactsPhone)}</a></p>`,
    );
  }
  if (content.footer.requisites) {
    parts.push(`<p>${esc(content.footer.requisites)}</p>`);
  }
  return parts.join("\n");
}

/**
 * Вставляет SEO-контент в HTML-оболочку SPA:
 * 1. заменяет <title> и мета-описания на актуальные из админки,
 * 2. уточняет canonical и og:url под запрошенный путь,
 * 3. добавляет скрытый блок с текстом страницы перед </body>,
 * 4. добавляет разметку schema.org (отзывы главной) и YandexRotorSettings —
 *    подсказку Яндексу дождаться клиентского рендера.
 */
function injectHead(
  html: string,
  seo: { title: string; description: string; block: string },
  path: string,
  jsonLd = "",
): string {
  let out = html;

  if (seo.title) {
    out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(seo.title)}</title>`);
    out = out.replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
      `$1${esc(seo.title)}$2`,
    );
  }
  if (seo.description) {
    out = out.replace(
      /(<meta\s+name="description"\s+content=")[^"]*(")/,
      `$1${esc(seo.description)}$2`,
    );
    out = out.replace(
      /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
      `$1${esc(seo.description)}$2`,
    );
  }

  // canonical и og:url — свойство каждой страницы: иначе внутренние страницы
  // «ссылались» бы на главную и выпадали из индекса.
  if (path && path !== "/") {
    out = out.replace(
      /(<link\s+rel="canonical"[^>]*href=")[^"]*(")/,
      `$1https://obzor71.ru${esc(path)}$2`,
    );
    out = out.replace(
      /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
      `$1https://obzor71.ru${esc(path)}$2`,
    );
  }

  const injection = `
<!-- SEO-пререндер: текст страницы для поисковых роботов (скрыт от
     посетителей, дублирует видимый контент) -->
<div style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap" aria-hidden="true">
${seo.block}
</div>
${jsonLd}
<script>
/* Подсказка Яндексу: контент на странице считается загруженным после
   клиентского рендера (отзывы и прочая динамика). */
window.YandexRotorSettings = { WaiterEnabled: true };
(function () {
  var timer = setInterval(function () {
    var root = document.getElementById("root");
    if (root && root.children.length > 0) {
      window.YandexRotorSettings.IsLoaded = true;
      clearInterval(timer);
    }
  }, 500);
})();
</script>
</body>`;

  if (out.includes("</body>")) {
    out = out.replace("</body>", injection);
  } else {
    out += injection;
  }
  return out;
}

/** Путь запроса в вид «/», «/privacy», «/p/price» (без хвостового слэша). */
function normalizePath(path: string): string {
  const clean = path.split("?")[0].split("#")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean.toLowerCase();
}

/**
 * Точка входа для сервера: HTML нужной страницы с SEO-пререндером.
 *
 *  /          — главная (тексты и отзывы),
 *  /privacy   — политика конфиденциальности (текст из админки),
 *  /p/<slug>  — дополнительная страница из админки,
 *  остальное  — обычная оболочка SPA (страницу «не найдено» рисует сам сайт).
 */
export async function renderIndexHtml(
  rawHtml: string,
  path: string = "/",
): Promise<string> {
  const normalized = normalizePath(path);

  if (normalized === "/") {
    const [content, reviews] = await Promise.all([
      loadContent(),
      loadPublishedReviews(),
    ]);
    return injectHead(
      rawHtml,
      {
        title: content.seo.title,
        description: content.seo.description,
        block: buildSeoBlock(content) + buildReviewsBlock(content, reviews),
      },
      "/",
      buildReviewsJsonLd(reviews),
    );
  }

  if (normalized === "/privacy") {
    const [privacy, content] = await Promise.all([loadPrivacy(), loadContent()]);
    return injectHead(
      rawHtml,
      {
        title: privacy.seoTitle,
        description: privacy.seoDescription,
        block: buildPrivacyBlock(privacy, content),
      },
      normalized,
    );
  }

  if (normalized.startsWith("/p/")) {
    const [pages, content] = await Promise.all([loadPages(), loadContent()]);
    const page = findPage(pages, normalized.slice(3));
    if (page && page.visible) {
      return injectHead(
        rawHtml,
        {
          title: pageSeoTitle(page),
          description: page.seoDescription,
          block: buildPageBlock(
            page,
            content.form.phoneValue,
            content.form.phoneHref,
          ),
        },
        pagePath(page.slug),
      );
    }
  }

  return rawHtml;
}

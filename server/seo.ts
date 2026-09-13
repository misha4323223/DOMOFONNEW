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
import { storage } from "./storage";
import type { Review } from "./ydb";

const CONTENT_SETTING_KEY = "content:home";
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

/**
 * Вставляет SEO-контент в HTML-оболочку SPA:
 * 1. заменяет <title> и мета-описания на актуальные из админки,
 * 2. добавляет скрытый блок с текстом сайта и отзывами перед </body>,
 * 3. добавляет разметку schema.org с рейтингом и отзывами,
 * 4. добавляет YandexRotorSettings — подсказку Яндексу дождаться
 *    клиентского рендера (для остальной динамики на странице).
 */
export function injectSeo(
  html: string,
  content: HomeContent,
  reviews: Review[] = [],
): string {
  const { seo } = content;
  let out = html;

  if (seo.title) {
    out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(seo.title)}</title>`);
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
  if (seo.title) {
    out = out.replace(
      /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
      `$1${esc(seo.title)}$2`,
    );
  }

  const block = buildSeoBlock(content) + buildReviewsBlock(content, reviews);
  const ratingJsonLd = buildReviewsJsonLd(reviews);
  const injection = `
<!-- SEO-пререндер: текст сайта и отзывы для поисковых роботов (скрыт от
     посетителей, дублирует видимый контент) -->
<div style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap" aria-hidden="true">
${block}
</div>
${ratingJsonLd}
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

/** Точка входа для сервера: готовый HTML главной страницы с SEO-пререндером. */
export async function renderIndexHtml(rawHtml: string): Promise<string> {
  const [content, reviews] = await Promise.all([
    loadContent(),
    loadPublishedReviews(),
  ]);
  return injectSeo(rawHtml, content, reviews);
}

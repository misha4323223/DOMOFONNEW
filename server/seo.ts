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
 */
import { sanitizeContent, type HomeContent } from "@shared/content";
import { storage } from "./storage";

const CONTENT_SETTING_KEY = "content:home";
/** Контент меняется редко (правки из админки) — кэшируем на 5 минут. */
const CONTENT_TTL_MS = 5 * 60 * 1000;

/** Экранирование текста для безопасной вставки в HTML-атрибуты и тело. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let contentCache: { content: HomeContent; at: number } | null = null;

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
 * Вставляет SEO-контент в HTML-оболочку SPA:
 * 1. заменяет <title> и мета-описания на актуальные из админки,
 * 2. добавляет скрытый блок с текстом сайта перед </body>,
 * 3. добавляет YandexRotorSettings — подсказку Яндексу дождаться
 *    клиентского рендера (для динамики вроде отзывов).
 */
export function injectSeo(html: string, content: HomeContent): string {
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

  const block = buildSeoBlock(content);
  const injection = `
<!-- SEO-пререндер: текст сайта для поисковых роботов (скрыт от посетителей,
     дублирует видимый контент) -->
<div style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap" aria-hidden="true">
${block}
</div>
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
  const content = await loadContent();
  return injectSeo(rawHtml, content);
}

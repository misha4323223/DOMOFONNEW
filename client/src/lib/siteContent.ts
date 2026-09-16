import { useEffect, useState } from "react";
import {
  DEFAULT_CONTENT,
  cloneContent,
  sanitizeContent,
  type HomeContent,
} from "@shared/content";
import { sanitizePages, type SitePage } from "@shared/pages";
import {
  DEFAULT_PRIVACY,
  sanitizePrivacy,
  type PrivacyContent,
} from "@shared/privacy";

/**
 * Контент главной страницы для посетителей: значения по умолчанию показываются
 * сразу (без мигания), затем подменяются сохранёнными через админку.
 * Все секции лендинга читают тексты из этого хука.
 */
export function useSiteContent(): HomeContent {
  const [content, setContent] = useState<HomeContent>(() =>
    cloneContent(DEFAULT_CONTENT),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/content", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { content?: unknown };
        if (!cancelled && data.content) {
          // Подстраховка: даже если сервер старше клиента, недостающие поля
          // добираются из дефолтов.
          setContent(sanitizeContent(data.content));
        }
      } catch {
        // Сайт обязан работать и без бэкенда: остаёмся на дефолтных текстах.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // SEO-поля из админки (title/description/keywords) применяем в браузере —
  // поисковик, выполняющий JS, увидит уже сохранённые значения.
  useEffect(() => {
    applySeoMeta(content.seo);
  }, [content.seo]);

  return content;
}

/**
 * Дополнительные страницы сайта (/p/<slug>), созданные в админке.
 * `null` — ещё загружаются: страница по этому признаку показывает
 * заглушку вместо «страница не найдена» на время запроса.
 */
export function useSitePages(): SitePage[] | null {
  const [pages, setPages] = useState<SitePage[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/pages", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setPages([]);
          return;
        }
        const data = (await res.json()) as { pages?: unknown };
        if (!cancelled) setPages(sanitizePages(data.pages));
      } catch {
        // Без сети показываем пустой список — сайт обязан открываться
        if (!cancelled) setPages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return pages;
}

/**
 * Текст страницы «Политика конфиденциальности»: значения по умолчанию
 * показываются сразу, затем подменяются правками из админки.
 */
export function usePrivacyContent(): PrivacyContent {
  const [content, setContent] = useState<PrivacyContent>(() =>
    cloneContent(DEFAULT_PRIVACY),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/privacy", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { content?: unknown };
        if (!cancelled && data.content) {
          setContent(sanitizePrivacy(data.content));
        }
      } catch {
        // Сайт обязан работать и без бэкенда: остаёмся на тексте по умолчанию.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Мета-теги страницы (title/description) — из админки, для поисковиков,
  // которые выполняют JavaScript.
  useEffect(() => {
    applyPageSeoMeta(content.seoTitle, content.seoDescription);
  }, [content.seoTitle, content.seoDescription]);

  return content;
}

/** Подменяет title и описание страницы (для внутренних страниц сайта). */
export function applyPageSeoMeta(title: string, description: string): void {
  if (title) document.title = title;
  if (description) {
    const el = document.head.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (el) el.setAttribute("content", description);
  }
}

function applySeoMeta(seo: HomeContent["seo"]): void {
  document.title = seo.title;

  const setMeta = (attr: "name" | "property", key: string, value: string) => {
    const el = document.head.querySelector<HTMLMetaElement>(
      `meta[${attr}="${key}"]`,
    );
    if (el) el.setAttribute("content", value);
  };

  setMeta("name", "description", seo.description);
  setMeta("name", "keywords", seo.keywords);
  setMeta("property", "og:title", seo.title);
  setMeta("property", "og:description", seo.description);
  setMeta(
    "property",
    "og:site_name",
    `${seo.brandName} — домофонная служба`,
  );
}

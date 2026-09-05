import { useEffect, useState } from "react";
import {
  DEFAULT_CONTENT,
  cloneContent,
  sanitizeContent,
  type HomeContent,
} from "@shared/content";

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

import { useEffect } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import {
  applyPageSeoMeta,
  useSiteContent,
  useSitePages,
} from "@/lib/siteContent";
import {
  findPage,
  normalizeSlug,
  pageSeoTitle,
  type PageBlock,
  type SitePage,
} from "@shared/pages";

/** Ссылка внутри блока: внутренние адреса открываем роутером, остальное — <a>. */
function BlockLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link
        href={href}
        className="font-semibold text-primary hover:underline"
      >
        {children}
      </Link>
    );
  }
  return (
    <a
      href={href}
      className="font-semibold text-primary hover:underline"
      {...(href.startsWith("http")
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {children}
    </a>
  );
}

/** Один блок страницы. Поля берём по типу — лишние просто не выводятся. */
function BlockView({ block }: { block: PageBlock }) {
  switch (block.type) {
    case "heading":
      return block.level === "3" ? (
        <h3 className="text-2xl font-semibold">{block.text}</h3>
      ) : (
        <h2 className="text-3xl font-bold">{block.text}</h2>
      );
    case "text":
      return (
        <div className="space-y-3">
          {block.text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, index) => (
              <p key={index} className="text-muted-foreground leading-relaxed">
                {line}
              </p>
            ))}
        </div>
      );
    case "list":
      return (
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground leading-relaxed">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      );
    case "image":
      return (
        <figure>
          <img
            src={block.url}
            alt={block.alt || block.text}
            loading="lazy"
            className="w-full rounded-2xl border"
          />
          {block.text && (
            <figcaption className="mt-2 text-center text-sm text-muted-foreground">
              {block.text}
            </figcaption>
          )}
        </figure>
      );
    case "button":
      if (!block.text) return null;
      return (
        <div>
          {block.href ? (
            <Button asChild size="lg">
              <a
                href={block.href}
                {...(block.href.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {block.text}
              </a>
            </Button>
          ) : (
            <p className="text-muted-foreground leading-relaxed">{block.text}</p>
          )}
        </div>
      );
    default:
      return null;
  }
}

/**
 * Страница, созданная в админке (адрес /p/<slug>).
 *
 * Содержимое и мета-теги приходят из админки; для поисковых роботов тот же
 * текст вставлен в HTML на сервере (server/seo.ts), поэтому страница видна
 * в индексе даже без выполнения JavaScript.
 */
export default function SitePage() {
  const params = useParams<{ slug?: string }>();
  const slug = normalizeSlug(params?.slug ?? "");
  const content = useSiteContent();
  const pages = useSitePages();
  const page: SitePage | undefined = pages ? findPage(pages, slug) : undefined;

  const seoTitle = page ? pageSeoTitle(page) : "";
  const seoDescription = page?.seoDescription ?? "";
  useEffect(() => {
    if (seoTitle) applyPageSeoMeta(seoTitle, seoDescription);
  }, [seoTitle, seoDescription]);

  const goToForm = () => {
    // Форма заявки живёт на главной — с внутренней страницы возвращаемся туда
    window.location.assign("/#request-form");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        content={content.header}
        pages={pages ?? []}
        onRequestClick={goToForm}
      />
      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-6 py-14">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-10"
          >
            <ArrowLeft className="h-4 w-4" />
            На главную
          </Link>

          {pages === null ? (
            <div className="flex items-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Загружаем страницу…
            </div>
          ) : !page ? (
            <div className="py-10">
              <h1 className="text-3xl font-bold mb-3">
                Страница не найдена
              </h1>
              <p className="text-muted-foreground leading-relaxed">
                Возможно, страницу переименовали или скрыли. Откройте главную
                или позвоните нам — подскажем по телефону.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/">На главную</Link>
                </Button>
                {content.form.phoneValue && (
                  <Button asChild variant="outline">
                    <a href={content.form.phoneHref}>{content.form.phoneValue}</a>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-4xl font-bold mb-8">{page.title}</h1>
              <div className="space-y-6">
                {page.blocks.map((block, index) => (
                  <BlockView key={index} block={block} />
                ))}
              </div>

              <div className="mt-12 rounded-2xl border bg-card/50 p-6">
                <p className="text-sm text-muted-foreground">
                  Не нашли ответ на свой вопрос? Оставьте заявку — перезвоним
                  в рабочее время (будни с 10:00 до 16:00).
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button asChild>
                    <Link href="/#request-form">Оставить заявку</Link>
                  </Button>
                  {content.form.phoneValue && (
                    <Button asChild variant="outline">
                      <a href={content.form.phoneHref}>
                        {content.form.phoneValue}
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              {/* Ссылка на политику — обязательна для форм с персональными данными */}
              <p className="mt-8 text-xs text-muted-foreground">
                <BlockLink href={content.footer.privacyHref}>
                  {content.footer.privacyText}
                </BlockLink>
              </p>
            </>
          )}
        </article>
      </main>
      <Footer content={content.footer} pages={pages ?? []} />
    </div>
  );
}

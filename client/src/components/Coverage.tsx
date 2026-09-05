import { MapPin, PhoneCall } from "lucide-react";
import type { CoverageContent, CoverageMode } from "@shared/content";

function normalizeMode(mode: string | undefined): CoverageMode {
  return mode === "visible" || mode === "hidden" ? mode : "seo-only";
}

export function Coverage({ content }: { content: CoverageContent }) {
  const mode = normalizeMode(content.mode);

  // hidden — блок полностью убран со страницы (и из HTML для поисковиков).
  if (mode === "hidden") return null;

  // seo-only — блок скрыт визуально (sr-only), но остаётся в HTML и доступен
  // поисковикам: в нём ключевые фразы — ИП Бухтеев, города и зона работы.
  // Если блок снова нужно показать посетителям — выберите «visible» в админке.
  return (
    <section
      className={mode === "seo-only" ? "sr-only" : undefined}
      id="coverage"
    >
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            data-testid="text-coverage-title"
          >
            {content.title}
          </h2>
          <p
            className="text-lg text-muted-foreground leading-relaxed"
            data-testid="text-coverage-subtitle"
          >
            {content.subtitle}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {content.cities.map((city, index) => (
            <div
              key={city.name}
              className="bg-card border rounded-2xl p-6 hover-elevate transition-all duration-300"
              data-testid={`card-coverage-${index}`}
            >
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <MapPin className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">{city.name}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {city.note}
              </p>
            </div>
          ))}
        </div>

        <p
          className="text-center text-muted-foreground mt-10"
          data-testid="text-coverage-more"
        >
          {content.morePrefix}
          <a
            href={content.phoneHref}
            className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
            data-testid="link-coverage-phone"
          >
            <PhoneCall className="h-4 w-4" />
            {content.phoneLabel}
          </a>
        </p>
      </div>
    </section>
  );
}

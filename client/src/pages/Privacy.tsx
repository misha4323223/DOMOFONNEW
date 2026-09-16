import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { usePrivacyContent } from "@/lib/siteContent";
import { privacyParagraphs } from "@shared/privacy";

/**
 * Страница «Политика конфиденциальности».
 *
 * Текст приходит из админки (Сайт → Политика конфиденциальности) и хранится
 * на сервере; пока он грузится (или если связи нет), показываются значения
 * по умолчанию — те же, что были в коде раньше.
 */
export default function Privacy() {
  const content = usePrivacyContent();
  const hasContacts =
    Boolean(content.contactsHeading) ||
    Boolean(content.contactsName) ||
    Boolean(content.contactsPhone);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-10"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="text-4xl font-bold mb-3">{content.title}</h1>
        {content.updatedLabel && (
          <p className="text-sm text-muted-foreground mb-12">
            {content.updatedLabel}
          </p>
        )}

        <div className="space-y-10">
          {content.sections.map((section, sectionIndex) => {
            const paragraphs = privacyParagraphs(section.text);
            return (
              <section key={`${section.heading}-${sectionIndex}`}>
                {section.heading && (
                  <h2 className="text-2xl font-semibold mb-3">
                    {section.heading}
                  </h2>
                )}
                {paragraphs.map((text, index) => (
                  <p
                    key={index}
                    className={`text-muted-foreground leading-relaxed ${
                      index === 0 ? "" : "mt-3"
                    }`}
                  >
                    {text}
                  </p>
                ))}
                {section.items.length > 0 && (
                  <ul
                    className={`list-disc pl-6 text-muted-foreground leading-relaxed space-y-2 ${
                      paragraphs.length > 0 || section.heading ? "mt-3" : ""
                    }`}
                  >
                    {section.items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {hasContacts && (
            <section>
              {content.contactsHeading && (
                <h2 className="text-2xl font-semibold mb-3">
                  {content.contactsHeading}
                </h2>
              )}
              {content.contactsName && (
                <p className="text-muted-foreground leading-relaxed">
                  {content.contactsName}
                </p>
              )}
              {content.contactsPhone && (
                <p className="text-muted-foreground leading-relaxed mt-1">
                  Телефон:{" "}
                  <a
                    href={content.contactsPhoneHref}
                    className="text-primary hover:underline"
                  >
                    {content.contactsPhone}
                  </a>
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

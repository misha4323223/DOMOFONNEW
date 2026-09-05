import { Sparkles } from "lucide-react";
import { Link } from "wouter";
import type { FooterContent } from "@shared/content";

/**
 * Ссылка футера: внутренние страницы сайта (/privacy) открываем роутером,
 * якоря и tel:/mailto: — обычным <a>, чтобы SPA-роутер не перехватывал их.
 */
function FooterLink({ href, label }: { href: string; label: string }) {
  if (href.startsWith("/") && !href.startsWith("//")) {
    return (
      <Link
        href={href}
        className="hover:text-primary transition-colors"
      >
        {label}
      </Link>
    );
  }
  return (
    <a href={href} className="hover:text-primary transition-colors">
      {label}
    </a>
  );
}

export function Footer({ content }: { content: FooterContent }) {
  const currentYear = new Date().getFullYear();
  const copyright = content.copyrightText.replace(/\{year\}/g, String(currentYear));

  return (
    <footer className="bg-card border-t py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="font-bold text-lg mb-4" data-testid="text-footer-company">
              {content.companyTitle}
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {content.companyDescription}
            </p>
          </div>

          <div>
            <h4 className="font-semibold mb-4">{content.servicesTitle}</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {content.servicesLinks.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <FooterLink href={link.href} label={link.label} />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">{content.contactsTitle}</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {content.contactsLinks.map((link) => (
                <li key={`${link.label}-${link.href}`}>
                  <FooterLink href={link.href} label={link.label} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-footer-copyright">
              {copyright}
            </p>
            <p
              className="text-sm text-muted-foreground flex items-center gap-1.5"
              data-testid="text-footer-credit"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>{content.developedByText}</span>
              <a
                href={content.studioHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground hover:text-primary transition-colors"
                data-testid="link-footer-credit"
              >
                {content.studioName}
              </a>
            </p>
          </div>
          <div className="mt-4 pt-4 border-t flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p data-testid="text-footer-requisites">{content.requisites}</p>
            <Link
              href={content.privacyHref}
              className="hover:text-primary transition-colors"
              data-testid="link-footer-privacy"
            >
              {content.privacyText}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

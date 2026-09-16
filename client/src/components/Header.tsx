import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import type { HeaderContent } from "@shared/content";
import { menuPages, pageMenuLabel, pagePath, type SitePage } from "@shared/pages";

interface HeaderProps {
  content: HeaderContent;
  /** Страницы из админки: те, где включена ссылка в меню. */
  pages?: SitePage[];
  onRequestClick: () => void;
}

export function Header({ content, pages = [], onRequestClick }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pathname] = useLocation();
  const onHomePage = pathname === "/";
  const navPages = menuPages(pages);

  /**
   * Пункты меню — якоря секций главной. С внутренней страницы (например,
   * /p/price) якоря на странице не существует, поэтому сначала возвращаемся
   * на главную — так работают ссылки на карточках страниц и в подвале.
   */
  const scrollToSection = (href: string) => {
    setMobileMenuOpen(false);
    if (!onHomePage) {
      window.location.assign(href.startsWith("#") ? `/${href}` : "/");
      return;
    }
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const linkClass =
    "text-sm font-medium text-muted-foreground hover:text-primary transition-colors";

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="leading-tight">
              {/* Логотип — не H1: единственный H1 страницы живёт в первом экране */}
              <Link href="/" className="block" data-testid="link-header-home">
                <p className="text-lg font-bold" data-testid="text-header-logo">
                  {content.logoTitle}
                </p>
                {content.logoSubtitle && (
                  <p className="text-xs text-muted-foreground" data-testid="text-header-legal">
                    {content.logoSubtitle}
                  </p>
                )}
              </Link>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {content.nav.map((item) => (
              <button
                key={`${item.label}-${item.href}`}
                onClick={() => scrollToSection(item.href)}
                className={linkClass}
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                {item.label}
              </button>
            ))}
            {/* Ссылки на страницы, созданные в админке (галочка «в меню») */}
            {navPages.map((page) => (
              <Link
                key={page.slug}
                href={pagePath(page.slug)}
                className={linkClass}
                data-testid={`link-nav-page-${page.slug}`}
              >
                {pageMenuLabel(page)}
              </Link>
            ))}
            <Button
              onClick={onRequestClick}
              data-testid="button-header-request"
            >
              {content.ctaText}
            </Button>
            <ThemeToggle />
          </nav>

          {/* Mobile Menu Button */}
          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              data-testid="button-mobile-menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav className="md:hidden py-4 border-t">
            <div className="flex flex-col gap-4">
              {content.nav.map((item) => (
                <button
                  key={`${item.label}-${item.href}`}
                  onClick={() => scrollToSection(item.href)}
                  className={`${linkClass} text-left`}
                  data-testid={`link-mobile-${item.label.toLowerCase()}`}
                >
                  {item.label}
                </button>
              ))}
              {navPages.map((page) => (
                <Link
                  key={page.slug}
                  href={pagePath(page.slug)}
                  className={linkClass}
                  onClick={() => setMobileMenuOpen(false)}
                  data-testid={`link-mobile-page-${page.slug}`}
                >
                  {pageMenuLabel(page)}
                </Link>
              ))}
              <Button
                onClick={() => {
                  onRequestClick();
                  setMobileMenuOpen(false);
                }}
                className="w-full"
                data-testid="button-mobile-request"
              >
                {content.ctaText}
              </Button>
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}

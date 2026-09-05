import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import type { HeaderContent } from "@shared/content";

interface HeaderProps {
  content: HeaderContent;
  onRequestClick: () => void;
}

export function Header({ content, onRequestClick }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollToSection = (href: string) => {
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="leading-tight">
              <h1 className="text-lg font-bold" data-testid="text-header-logo">
                {content.logoTitle}
              </h1>
              {content.logoSubtitle && (
                <p className="text-xs text-muted-foreground" data-testid="text-header-legal">
                  {content.logoSubtitle}
                </p>
              )}
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {content.nav.map((item) => (
              <button
                key={`${item.label}-${item.href}`}
                onClick={() => scrollToSection(item.href)}
                className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
                data-testid={`link-nav-${item.label.toLowerCase()}`}
              >
                {item.label}
              </button>
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
                  className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors text-left"
                  data-testid={`link-mobile-${item.label.toLowerCase()}`}
                >
                  {item.label}
                </button>
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

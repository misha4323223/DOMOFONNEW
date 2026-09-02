import { Sparkles } from "lucide-react";
import { Link } from "wouter";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-card border-t py-12">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="font-bold text-lg mb-4" data-testid="text-footer-company">
              Домофонная служба | ИП Бухтеев
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Профессиональная установка и ремонт домофонных систем с гарантией качества.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Услуги</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#services" className="hover:text-primary transition-colors" data-testid="link-footer-installation">
                  Установка домофонов
                </a>
              </li>
              <li>
                <a href="#services" className="hover:text-primary transition-colors" data-testid="link-footer-repair">
                  Ремонт и обслуживание
                </a>
              </li>
              <li>
                <a href="#request-form" className="hover:text-primary transition-colors" data-testid="link-footer-request">
                  Оставить заявку
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4">Контакты</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="tel:+79056298708" className="hover:text-primary transition-colors" data-testid="link-footer-phone">
                  +7 (905) 629-87-08
                </a>
              </li>
              <li>
                <a href="mailto:info@domofon-service.ru" className="hover:text-primary transition-colors" data-testid="link-footer-email">
                  info@domofon-service.ru
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="text-footer-copyright">
              © {currentYear} ИП Бухтеев. Все права защищены.
            </p>
            <p
              className="text-sm text-muted-foreground flex items-center gap-1.5"
              data-testid="text-footer-credit"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Разработано в</span>
              <a
                href="https://mp-webstudio.ru"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-foreground hover:text-primary transition-colors"
                data-testid="link-footer-credit"
              >
                MP Web Studio
              </a>
            </p>
          </div>
          <div className="mt-4 pt-4 border-t flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <p data-testid="text-footer-requisites">
              ИП Бухтеев Сергей Валерьевич · ИНН 711610551800 · ОГРНИП 309715404200227
            </p>
            <Link
              href="/privacy"
              className="hover:text-primary transition-colors"
              data-testid="link-footer-privacy"
            >
              Политика конфиденциальности
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

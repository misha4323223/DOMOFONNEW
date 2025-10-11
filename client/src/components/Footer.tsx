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
                <a href="tel:+7XXXXXXXXXX" className="hover:text-primary transition-colors" data-testid="link-footer-phone">
                  +7 (XXX) XXX-XX-XX
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

        <div className="pt-8 border-t text-center">
          <p className="text-sm text-muted-foreground" data-testid="text-footer-copyright">
            © {currentYear} ИП Бухтеев. Все права защищены.
          </p>
        </div>
      </div>
    </footer>
  );
}

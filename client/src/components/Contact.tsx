import { Phone, Clock, Mail, MapPin, type LucideIcon } from "lucide-react";
import type { ContactContent } from "@shared/content";

// Иконки карточек: телефон, часы, почта, адрес — повторяются по кругу
const ICONS: LucideIcon[] = [Phone, Clock, Mail, MapPin];

export function Contact({ content }: { content: ContactContent }) {
  return (
    <section className="py-20 bg-muted/30" id="contact">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4" data-testid="text-contact-title">
            {content.title}
          </h2>
          <p className="text-lg text-muted-foreground" data-testid="text-contact-subtitle">
            {content.subtitle}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {content.items.map((item, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <div
                key={index}
                className="bg-card p-6 rounded-2xl border hover-elevate shadow-sm transition-all duration-300"
                data-testid={`card-contact-${index}`}
              >
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{item.title}</h3>
                {item.href ? (
                  <a
                    href={item.href}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors break-all"
                    data-testid={`link-contact-${index}`}
                  >
                    {item.value}
                  </a>
                ) : (
                  <p className="text-sm text-muted-foreground">{item.value}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

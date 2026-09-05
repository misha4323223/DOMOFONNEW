import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Wrench, type LucideIcon } from "lucide-react";
import type { ServicesContent } from "@shared/content";

// Иконки карточек услуг: при добавлении новых карточек иконки повторяются по кругу
const ICONS: LucideIcon[] = [Settings, Wrench];

export function Services({ content }: { content: ServicesContent }) {
  return (
    <section className="py-20 bg-background" id="services">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4" data-testid="text-services-title">
            {content.title}
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-services-subtitle">
            {content.subtitle}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {content.items.map((service, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <Card
                key={index}
                className="hover-elevate transition-all duration-300"
                data-testid={`card-service-${index}`}
              >
                <CardHeader className="space-y-4">
                  <div className="w-14 h-14 rounded-md bg-primary/10 flex items-center justify-center">
                    <Icon className="h-7 w-7 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">{service.title}</CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {service.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {service.features.map((feature, idx) => (
                      <li key={idx} className="flex items-center text-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary mr-3" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

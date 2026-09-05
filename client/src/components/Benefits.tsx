import { Shield, Clock, Award, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { BenefitsContent } from "@shared/content";

// Иконки преимуществ: повторяются по кругу, если карточек больше трёх
const ICONS: LucideIcon[] = [Shield, Clock, Award];

export function Benefits({ content }: { content: BenefitsContent }) {
  return (
    <section className="py-20 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4" data-testid="text-benefits-title">
            {content.title}
          </h2>
          <p className="text-lg text-muted-foreground" data-testid="text-benefits-subtitle">
            {content.subtitle}
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {content.items.map((benefit, index) => {
            const Icon = ICONS[index % ICONS.length];
            return (
              <Card
                key={index}
                className="hover-elevate transition-all duration-300"
                data-testid={`card-benefit-${index}`}
              >
                <CardContent className="pt-8 text-center">
                  <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-6">
                    <Icon className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{benefit.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {benefit.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

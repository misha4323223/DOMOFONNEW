import { Shield, Clock, Award } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function Benefits() {
  const benefits = [
    {
      icon: Shield,
      title: "Гарантия качества",
      description: "Все работы выполняются с последующим обслуживанием. Используем только проверенное оборудование."
    },
    {
      icon: Clock,
      title: "Быстрое устранение проблем",
      description: "Устраняем неисправности в течение 3 рабочих дней с момента обращения."
    },
    {
      icon: Award,
      title: "Работаем официально",
      description: "Заключаем договор на выполнение работ."
    }
  ];

  return (
    <section className="py-20 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4" data-testid="text-benefits-title">Почему выбирают нас</h2>
          <p className="text-lg text-muted-foreground" data-testid="text-benefits-subtitle">
            Профессиональный подход к каждому заказу
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {benefits.map((benefit, index) => (
            <Card key={index} className="hover-elevate transition-all duration-300" data-testid={`card-benefit-${index}`}>
              <CardContent className="pt-8 text-center">
                <div className="w-16 h-16 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-6">
                  <benefit.icon className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-3">{benefit.title}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {benefit.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

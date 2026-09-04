import { MapPin, PhoneCall } from "lucide-react";

const cities = [
  {
    name: "Богородицк",
    note: "Установка и ремонт домофонов, выезд мастера по городу и району",
  },
  {
    name: "Щёкино",
    note: "Домофоны и видеодомофоны в квартирах, домах и на подъездах",
  },
  {
    name: "Ефремов",
    note: "Обслуживание и ремонт домофонных систем, выезд мастера",
  },
];

export function Coverage() {
  return (
    <section className="py-20 bg-background border-t border-border/60" id="coverage">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2
            className="text-3xl md:text-4xl font-bold mb-4"
            data-testid="text-coverage-title"
          >
            Установка и ремонт домофонов в Богородицке, Щёкино и Ефремове
          </h2>
          <p
            className="text-lg text-muted-foreground leading-relaxed"
            data-testid="text-coverage-subtitle"
          >
            ИП Бухтеев — домофонная служба в Тульской области. Устанавливаем,
            ремонтируем и обслуживаем домофоны, видеодомофоны и подъездные
            домофонные системы — от квартирной трубки до вызывной панели на
            подъезде.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {cities.map((city, index) => (
            <div
              key={city.name}
              className="bg-card border rounded-2xl p-6 hover-elevate transition-all duration-300"
              data-testid={`card-coverage-${index}`}
            >
              <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-4">
                <MapPin className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">{city.name}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {city.note}
              </p>
            </div>
          ))}
        </div>

        <p
          className="text-center text-muted-foreground mt-10"
          data-testid="text-coverage-more"
        >
          Работаем и в других населённых пунктах Тульской области. Уточнить
          выезд в ваш город можно по телефону:{" "}
          <a
            href="tel:+79056298708"
            className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
            data-testid="link-coverage-phone"
          >
            <PhoneCall className="h-4 w-4" />
            +7 (905) 629-87-08
          </a>
        </p>
      </div>
    </section>
  );
}

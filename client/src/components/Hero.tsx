import { Button } from "@/components/ui/button";
import { ShieldCheck, Clock, FileCheck } from "lucide-react";
import heroImage from "@assets/ChatGPT Image 11 окт. 2025 г., 15_53_08_1760187202805.png";

interface HeroProps {
  onRequestClick: () => void;
}

const trustChips = [
  { icon: ShieldCheck, label: "Гарантия на работы" },
  { icon: Clock, label: "Отвечаем в будни 10:00–16:00" },
  { icon: FileCheck, label: "Договор и чеки" },
];

export function Hero({ onRequestClick }: HeroProps) {
  return (
    <section className="relative h-[85vh] min-h-[560px] flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImage})` }}
      />
      {/* Layered overlay: darker at the bottom for text contrast, brand tint overall */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/40 via-primary/30 to-background/90" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-background/40" />

      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <div
          className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 px-4 py-1.5 mb-6 text-sm font-medium text-white"
          data-testid="badge-hero-trust"
        >
          <ShieldCheck className="h-4 w-4" />
          Официально, с договором и гарантией
        </div>

        <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white mb-4 tracking-tight drop-shadow-sm" data-testid="text-company-name">
          Домофонная служба
        </h1>
        <p className="text-lg md:text-xl text-white/90 mb-2 font-medium" data-testid="text-company-subbrand">
          ИП Бухтеев
        </p>
        <p className="text-xl md:text-2xl text-white/95 mb-10 leading-relaxed max-w-2xl mx-auto" data-testid="text-company-tagline">
          Установка и тех. обслуживание домофонных систем
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10">
          <Button
            size="lg"
            className="text-lg px-8 py-6 h-auto shadow-lg shadow-primary/30"
            onClick={onRequestClick}
            data-testid="button-hero-request"
          >
            Оставить заявку
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="bg-white/10 backdrop-blur-sm border-white/25 text-white hover:bg-white/20 hover:text-white text-lg px-8 py-6 h-auto"
            onClick={() => document.querySelector('#services')?.scrollIntoView({ behavior: 'smooth' })}
            data-testid="button-hero-services"
          >
            Наши услуги
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {trustChips.map((chip, index) => (
            <div
              key={index}
              className="flex items-center gap-2 text-sm text-white/85"
              data-testid={`chip-hero-trust-${index}`}
            >
              <chip.icon className="h-4 w-4 text-white/90" />
              {chip.label}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

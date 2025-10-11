import { Button } from "@/components/ui/button";
import heroImage from "@assets/ChatGPT Image 11 окт. 2025 г., 15_53_08_1760187202805.png";

interface HeroProps {
  onRequestClick: () => void;
}

export function Hero({ onRequestClick }: HeroProps) {
  return (
    <section className="relative h-[80vh] min-h-[500px] flex items-center justify-center overflow-hidden">
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${heroImage})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-primary/50 to-primary/30" />
      
      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6" data-testid="text-company-name">
          Домофонная служба | ИП Бухтеев
        </h1>
        <p className="text-xl md:text-2xl text-white/95 mb-8 leading-relaxed" data-testid="text-company-tagline">
          Установка и тех. обслуживание домофонных систем
        </p>
        <Button 
          size="lg"
          variant="outline"
          className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20 text-lg px-8 py-6 h-auto"
          onClick={onRequestClick}
          data-testid="button-hero-request"
        >
          Оставить заявку
        </Button>
      </div>
    </section>
  );
}

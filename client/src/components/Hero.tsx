import { Button } from "@/components/ui/button";
import heroDesktop from "../../image/hero-desktop.webp";
import heroMobile from "../../image/hero-mobile.webp";

interface HeroProps {
  onRequestClick: () => void;
}

export function Hero({ onRequestClick }: HeroProps) {
  const scrollToServices = () =>
    document.querySelector("#services")?.scrollIntoView({ behavior: "smooth" });

  return (
    <section>
      <div className="relative h-[85vh] min-h-[560px] overflow-hidden">
        <picture className="absolute inset-0">
          <source media="(max-width: 767px)" srcSet={heroMobile} />
          <img
            src={heroDesktop}
            alt=""
            className="h-full w-full object-cover object-center"
          />
        </picture>
      </div>

      <div className="w-full border-y bg-card flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 px-6 py-3">
        <Button
          className="w-full sm:w-auto text-base px-7"
          onClick={onRequestClick}
          data-testid="button-hero-request"
        >
          Оставить заявку
        </Button>
        <Button
          variant="outline"
          className="w-full sm:w-auto text-base px-7"
          onClick={scrollToServices}
          data-testid="button-hero-services"
        >
          Наши услуги
        </Button>
      </div>
    </section>
  );
}

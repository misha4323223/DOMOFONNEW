import { Button } from "@/components/ui/button";
import type { HeroContent } from "@shared/content";
import heroDesktop from "../../image/hero-desktop.webp";
import heroMobile from "../../image/hero-mobile.webp";

interface HeroProps {
  content: HeroContent;
  onRequestClick: () => void;
}

export function Hero({ content, onRequestClick }: HeroProps) {
  const scrollToServices = () =>
    document.querySelector("#services")?.scrollIntoView({ behavior: "smooth" });

  // Пустая строка = стандартное фото из сборки сайта.
  // Своё фото, загруженное в админке, приходит путём вида /api/content/image/...
  const desktopSrc = content.desktopImage || heroDesktop;
  const mobileSrc = content.mobileImage || heroMobile;

  return (
    <section>
      <div className="relative h-[85vh] min-h-[560px] overflow-hidden">
        <picture className="absolute inset-0">
          <source media="(max-width: 767px)" srcSet={mobileSrc} />
          <img
            src={desktopSrc}
            alt={content.altText}
            className="h-full w-full object-cover object-center"
          />
        </picture>
      </div>

      <div className="hidden sm:flex w-full border-y bg-card items-center justify-center gap-4 px-6 py-3">
        <Button
          className="w-full sm:w-auto text-base px-7"
          onClick={onRequestClick}
          data-testid="button-hero-request"
        >
          {content.requestButtonText}
        </Button>
        <Button
          variant="outline"
          className="w-full sm:w-auto text-base px-7"
          onClick={scrollToServices}
          data-testid="button-hero-services"
        >
          {content.servicesButtonText}
        </Button>
      </div>
    </section>
  );
}

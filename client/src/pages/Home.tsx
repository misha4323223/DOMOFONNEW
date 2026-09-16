import { useEffect } from "react";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Services } from "@/components/Services";
import { Benefits } from "@/components/Benefits";
import { Reviews } from "@/components/Reviews";
import { Coverage } from "@/components/Coverage";
import { RequestForm } from "@/components/RequestForm";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";
import { useSiteContent, useSitePages } from "@/lib/siteContent";

export default function Home() {
  // Тексты всех секций приходят из админки (см. /api/content);
  // пока грузится контент — показываем значения по умолчанию.
  const content = useSiteContent();
  const pages = useSitePages();

  // Переход с внутренней страницы по ссылке вида /#request-form: секции
  // появляются только после отрисовки, поэтому прокручиваем с небольшой
  // задержкой (якорь браузера сам по себе до них не доберётся).
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    const timer = window.setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);

  const scrollToForm = () => {
    const formElement = document.querySelector('#request-form');
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        content={content.header}
        pages={pages ?? []}
        onRequestClick={scrollToForm}
      />
      <main className="flex-1">
        <Hero
          content={content.hero}
          brandName={content.seo.brandName}
          onRequestClick={scrollToForm}
        />
        <Services content={content.services} />
        <Benefits content={content.benefits} />
        <Coverage content={content.coverage} />
        <RequestForm content={content.form} />
        <Contact content={content.contact} />
        {/* Отзывы — ближе к подвалу, как просил владелец */}
        <Reviews content={content.reviews} />
      </main>
      <Footer content={content.footer} pages={pages ?? []} />
    </div>
  );
}

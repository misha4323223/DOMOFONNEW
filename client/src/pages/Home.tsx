import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Services } from "@/components/Services";
import { Benefits } from "@/components/Benefits";
import { Coverage } from "@/components/Coverage";
import { RequestForm } from "@/components/RequestForm";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";
import { useSiteContent } from "@/lib/siteContent";

export default function Home() {
  // Тексты всех секций приходят из админки (см. /api/content);
  // пока грузится контент — показываем значения по умолчанию.
  const content = useSiteContent();

  const scrollToForm = () => {
    const formElement = document.querySelector('#request-form');
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header content={content.header} onRequestClick={scrollToForm} />
      <main className="flex-1">
        <Hero content={content.hero} onRequestClick={scrollToForm} />
        <Services content={content.services} />
        <Benefits content={content.benefits} />
        <Coverage content={content.coverage} />
        <RequestForm content={content.form} />
        <Contact content={content.contact} />
      </main>
      <Footer content={content.footer} />
    </div>
  );
}

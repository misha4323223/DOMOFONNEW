import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Services } from "@/components/Services";
import { Benefits } from "@/components/Benefits";
import { RequestForm } from "@/components/RequestForm";
import { Contact } from "@/components/Contact";
import { Footer } from "@/components/Footer";

export default function Home() {
  const scrollToForm = () => {
    const formElement = document.querySelector('#request-form');
    if (formElement) {
      formElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header onRequestClick={scrollToForm} />
      <main className="flex-1">
        <Hero onRequestClick={scrollToForm} />
        <Services />
        <Benefits />
        <RequestForm />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}

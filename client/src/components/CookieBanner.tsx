import { useEffect, useState } from "react";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";

const CONSENT_KEY = "cookie-consent";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Показываем баннер, только если пользователь ещё не дал ответ
    if (!localStorage.getItem(CONSENT_KEY)) {
      const timer = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  const choose = (value: "accepted" | "declined") => {
    localStorage.setItem(CONSENT_KEY, value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-xl z-[60]">
      <div className="rounded-lg border bg-card/95 backdrop-blur shadow-xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <Cookie className="h-6 w-6 text-primary shrink-0 mt-0.5" />
        <p className="text-sm text-muted-foreground leading-relaxed flex-1">
          Мы используем файлы cookie и обрабатываем персональные данные в соответствии с
          Федеральным законом № 152-ФЗ «О персональных данных». Нажимая «Принять»,
          вы соглашаетесь с этим.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={() => choose("accepted")}>
            Принять
          </Button>
          <Button size="sm" variant="ghost" onClick={() => choose("declined")}>
            Отказаться
          </Button>
        </div>
      </div>
    </div>
  );
}

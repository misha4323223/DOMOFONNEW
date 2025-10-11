export function RequestForm() {
  // ============================================================================
  // КАК ВСТРОИТЬ СВОЮ GOOGLE FORM:
  // 
  // 1. Создайте форму на https://forms.google.com/
  // 2. Нажмите "Отправить" → выберите вкладку "< > (Встроить HTML)"
  // 3. Скопируйте ссылку из src="" (например: https://docs.google.com/.../viewform?embedded=true)
  // 4. Замените строку ниже на вашу ссылку
  // ============================================================================
  
  const googleFormUrl = "https://docs.google.com/forms/d/e/YOUR_FORM_ID/viewform?embedded=true";

  return (
    <section className="py-20 bg-background" id="request-form">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4" data-testid="text-form-title">
            Заявка на обслуживание
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto" data-testid="text-form-subtitle">
            Заполните форму ниже, и мы свяжемся с вами в ближайшее время. Обычно отвечаем в течение 1-2 часов.
          </p>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="bg-muted/30 p-6 border-b">
              <p className="text-sm text-muted-foreground text-center">
                📝 Пожалуйста, укажите: город, адрес, номер дома, квартиру и ваш телефон
              </p>
            </div>
            
            {/* Placeholder for Google Form */}
            <div className="relative bg-card" style={{ minHeight: '600px' }}>
              <iframe
                src={googleFormUrl}
                width="100%"
                height="600"
                frameBorder="0"
                marginHeight={0}
                marginWidth={0}
                className="w-full"
                title="Форма заявки"
                data-testid="iframe-google-form"
              >
                Загрузка…
              </iframe>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Или свяжитесь с нами напрямую: <span className="font-medium text-foreground">+7 (XXX) XXX-XX-XX</span>
          </p>
        </div>
      </div>
    </section>
  );
}

import { Card, CardContent } from "@/components/ui/card";

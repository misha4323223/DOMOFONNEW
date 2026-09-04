import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-14">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-10"
        >
          <ArrowLeft className="h-4 w-4" />
          На главную
        </Link>

        <h1 className="text-4xl font-bold mb-3">Политика конфиденциальности</h1>
        <p className="text-sm text-muted-foreground mb-12">
          Дата актуализации: 02 сентября 2026 г.
        </p>

        <div className="space-y-10">
          <section>
            <h2 className="text-2xl font-semibold mb-3">1. Общие положения</h2>
            <p className="text-muted-foreground leading-relaxed">
              Настоящая Политика конфиденциальности определяет порядок обработки и защиты
              персональных данных пользователей сайта obzor71.ru и действует в
              соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ
              «О персональных данных».
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Оператор персональных данных — индивидуальный предприниматель Бухтеев Сергей
              Валерьевич (ИНН 711610551800, ОГРНИП 309715404200227, Тульская область,
              Россия). Отправляя заявку через сайт, вы соглашаетесь с условиями настоящей
              Политики.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">2. Какие данные мы обрабатываем</h2>
            <ul className="list-disc pl-6 text-muted-foreground leading-relaxed space-y-2">
              <li>
                <strong className="text-foreground">Данные из формы заявки:</strong> имя,
                номер телефона, адрес и текст комментария — их вы указываете
                самостоятельно;
              </li>
              <li>
                <strong className="text-foreground">Технические данные:</strong> IP-адрес,
                сведения о браузере и устройстве, файлы cookie — собираются автоматически
                при посещении сайта.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">3. Цели обработки</h2>
            <ul className="list-disc pl-6 text-muted-foreground leading-relaxed space-y-2">
              <li>приём и обработка заявок на установку и ремонт домофонов;</li>
              <li>обратный звонок и связь с заявителем по указанному номеру;</li>
              <li>оказание услуг, согласование времени и адреса выезда;</li>
              <li>улучшение работы сайта.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">4. Правовые основания и сроки</h2>
            <p className="text-muted-foreground leading-relaxed">
              Обработка осуществляется на основании согласия субъекта персональных данных
              (п. 1 ч. 1 ст. 6 Федерального закона № 152-ФЗ), которое вы даёте, отмечая
              чекбокс в форме заявки. Данные хранятся не дольше, чем этого требуют цели
              обработки, и удаляются по вашему требованию.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">5. Передача данных третьим лицам</h2>
            <p className="text-muted-foreground leading-relaxed">
              Мы не передаём персональные данные третьим лицам, за исключением случаев,
              прямо предусмотренных законодательством Российской Федерации. Данные
              хранятся на серверах на территории РФ.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">6. Ваши права</h2>
            <p className="text-muted-foreground leading-relaxed">
              Вы вправе в любой момент отозвать согласие на обработку персональных данных,
              а также запросить сведения об обрабатываемых данных, их уточнение или
              удаление. Для этого достаточно отправить запрос по контактам, указанным ниже.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold mb-3">7. Контакты оператора</h2>
            <p className="text-muted-foreground leading-relaxed">
              ИП Бухтеев Сергей Валерьевич
              <br />
              Телефон:{" "}
              <a href="tel:+79056298708" className="text-primary hover:underline">
                +7 (905) 629-87-08
              </a>
              <br />
              E-mail:{" "}
              <a
                href="mailto:info@domofon-service.ru"
                className="text-primary hover:underline"
              >
                info@domofon-service.ru
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
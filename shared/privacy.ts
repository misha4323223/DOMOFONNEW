/**
 * Страница «Политика конфиденциальности» — текст, который админ правит сам.
 *
 * Раньше это был жёстко написанный JSX (client/src/pages/Privacy.tsx): чтобы
 * поменять формулировку или дату актуализации, приходилось править код и
 * деплоить сайт. Теперь текст лежит в настройках сайта, редактируется в
 * админке («Сайт → Политика конфиденциальности») и подставляется и в SPA,
 * и в HTML для поисковиков (server/seo.ts).
 *
 * ВАЖНО: структура разделов (заголовок + текст + список) повторяет прежнюю
 * вёрстку — так страница выглядит как раньше, но редактируется целиком.
 */

export const PRIVACY_LIMITS = {
  maxSections: 30,
  maxItems: 30,
  maxTextLength: 6000,
  maxHeadingLength: 200,
} as const;

export interface PrivacySection {
  /** Заголовок раздела («1. Общие положения»). */
  heading: string;
  /** Абзацы: каждая новая строка — отдельный абзац. */
  text: string;
  /** Пункты списка с маркерами (может быть пусто). */
  items: string[];
}

export interface PrivacyContent {
  /** Заголовок страницы для поисковой выдачи. */
  seoTitle: string;
  /** Описание страницы для поисковой выдачи. */
  seoDescription: string;
  /** Заголовок H1 на странице. */
  title: string;
  /** Строка под заголовком («Дата актуализации: …»). */
  updatedLabel: string;
  sections: PrivacySection[];
  /** Заголовок последнего блока с контактами оператора. */
  contactsHeading: string;
  /** Имя оператора персональных данных. */
  contactsName: string;
  /** Телефон как он виден посетителю. */
  contactsPhone: string;
  /** Ссылка для звонка (tel:+7…). */
  contactsPhoneHref: string;
}

export const DEFAULT_PRIVACY: PrivacyContent = {
  seoTitle: "Политика конфиденциальности — Обзор71",
  seoDescription:
    "Политика конфиденциальности сайта obzor71.ru: какие персональные данные обрабатывает домофонная служба ИП Бухтеев, с какой целью и как их защищает.",
  title: "Политика конфиденциальности",
  updatedLabel: "Дата актуализации: 02 сентября 2026 г.",
  sections: [
    {
      heading: "1. Общие положения",
      text: [
        "Настоящая Политика конфиденциальности определяет порядок обработки и защиты персональных данных пользователей сайта obzor71.ru и действует в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных».",
        "Оператор персональных данных — индивидуальный предприниматель Бухтеев Сергей Валерьевич (ИНН 711610551800, ОГРНИП 309715404200227, Тульская область, Россия). Отправляя заявку через сайт, вы соглашаетесь с условиями настоящей Политики.",
      ].join("\n"),
      items: [],
    },
    {
      heading: "2. Какие данные мы обрабатываем",
      text: "",
      items: [
        "Данные из формы заявки: имя, номер телефона, адрес и текст комментария — их вы указываете самостоятельно;",
        "Технические данные: IP-адрес, сведения о браузере и устройстве, файлы cookie — собираются автоматически при посещении сайта.",
      ],
    },
    {
      heading: "3. Цели обработки",
      text: "",
      items: [
        "приём и обработка заявок на установку и обслуживание домофонов;",
        "обратный звонок и связь с заявителем по указанному номеру;",
        "оказание услуг, согласование времени и адреса выезда;",
        "улучшение работы сайта.",
      ],
    },
    {
      heading: "4. Правовые основания и сроки",
      text: "Обработка осуществляется на основании согласия субъекта персональных данных (п. 1 ч. 1 ст. 6 Федерального закона № 152-ФЗ), которое вы даёте, отмечая чекбокс в форме заявки. Данные хранятся не дольше, чем этого требуют цели обработки, и удаляются по вашему требованию.",
      items: [],
    },
    {
      heading: "5. Передача данных третьим лицам",
      text: "Мы не передаём персональные данные третьим лицам, за исключением случаев, прямо предусмотренных законодательством Российской Федерации. Данные хранятся на серверах на территории РФ.",
      items: [],
    },
    {
      heading: "6. Ваши права",
      text: "Вы вправе в любой момент отозвать согласие на обработку персональных данных, а также запросить сведения об обрабатываемых данных, их уточнение или удаление. Для этого достаточно отправить запрос по контактам, указанным ниже.",
      items: [],
    },
  ],
  contactsHeading: "7. Контакты оператора",
  contactsName: "ИП Бухтеев Сергей Валерьевич",
  contactsPhone: "+7 (905) 629-87-08",
  contactsPhoneHref: "tel:+79056298708",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+$/g, "");
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Накладывает сохранённые правки на значения по умолчанию. */
export function sanitizePrivacy(input: unknown): PrivacyContent {
  if (!isRecord(input)) {
    return JSON.parse(JSON.stringify(DEFAULT_PRIVACY)) as PrivacyContent;
  }

  const sections: PrivacySection[] = [];
  if (Array.isArray(input.sections)) {
    for (const raw of input.sections.slice(0, PRIVACY_LIMITS.maxSections)) {
      if (!isRecord(raw)) continue;
      const heading = str(raw.heading, PRIVACY_LIMITS.maxHeadingLength).trim();
      const text = str(raw.text, PRIVACY_LIMITS.maxTextLength);
      const items: string[] = [];
      if (Array.isArray(raw.items)) {
        for (const item of raw.items.slice(0, PRIVACY_LIMITS.maxItems)) {
          const text_ = str(item, PRIVACY_LIMITS.maxTextLength).trim();
          if (text_) items.push(text_);
        }
      }
      // Пустой раздел (без заголовка и текста) на странице не нужен.
      if (!heading && !text.trim() && items.length === 0) continue;
      sections.push({ heading, text, items });
    }
  }

  return {
    seoTitle: str(input.seoTitle, PRIVACY_LIMITS.maxHeadingLength).trim() || DEFAULT_PRIVACY.seoTitle,
    seoDescription:
      str(input.seoDescription, 400).trim() || DEFAULT_PRIVACY.seoDescription,
    title: str(input.title, PRIVACY_LIMITS.maxHeadingLength).trim() || DEFAULT_PRIVACY.title,
    updatedLabel: str(input.updatedLabel, PRIVACY_LIMITS.maxHeadingLength).trim(),
    sections,
    contactsHeading: str(input.contactsHeading, PRIVACY_LIMITS.maxHeadingLength).trim(),
    contactsName: str(input.contactsName, PRIVACY_LIMITS.maxHeadingLength).trim(),
    contactsPhone: str(input.contactsPhone, 60).trim(),
    contactsPhoneHref: /^tel:[+\d\s()-]{5,30}$/.test(
      str(input.contactsPhoneHref, 60).trim(),
    )
      ? str(input.contactsPhoneHref, 60).trim()
      : DEFAULT_PRIVACY.contactsPhoneHref,
  };
}

/** Абзацы текста раздела: каждая непустая строка — отдельный абзац. */
export function privacyParagraphs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

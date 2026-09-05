/**
 * Контент главной страницы, которым управляет админ через «глубокий редактор».
 *
 * Копия shared/content.ts для мобильного приложения: Metro не умеет импортировать
 * файлы за пределами корня mobile/, поэтому модуль продублирован (как и типы
 * заявок в api.ts). При правках в shared/content.ts — синхронизировать сюда.
 *
 * Здесь живут:
 *  - типы всех секций лендинга (тексты «каждой мелочи»),
 *  - DEFAULT_CONTENT — значения по умолчанию (то, что сейчас на сайте),
 *  - sanitizeContent() — очистка/наложение произвольного JSON поверх
 *    дефолтов (используется и сервером при сохранении, и клиентом при чтении).
 *
 * Значения по умолчанию менять можно — новые поля автоматически «подхватятся»
 * как старыми, так и новыми версиями, потому что наложение идёт от дефолтов.
 */

// --- Ключи изображений, которые админ может загрузить для первого экрана ---
export const HERO_IMAGE_KEYS = ["hero-desktop", "hero-mobile"] as const;
export type HeroImageKey = (typeof HERO_IMAGE_KEYS)[number];

export type CoverageMode = "visible" | "seo-only" | "hidden";

export interface NavLink {
  label: string;
  href: string;
}

export interface SeoContent {
  /** Название бренда — Обзор71. Подставляется в сайт-name и подписи. */
  brandName: string;
  /** Тег <title> страницы (поисковая выдача). */
  title: string;
  /** Мета-описание (поисковая выдача). */
  description: string;
  /** Ключевые слова, через запятую. */
  keywords: string;
}

export interface HeaderContent {
  /** Главный заголовок в шапке (логотип). */
  logoTitle: string;
  /** Подпись под названием (юридическое имя и т.п.). */
  logoSubtitle: string;
  nav: NavLink[];
  /** Текст кнопки «Оставить заявку». */
  ctaText: string;
}

export interface HeroContent {
  /** Кнопка над фото — «Оставить заявку». */
  requestButtonText: string;
  /** Кнопка над фото — «Наши услуги». */
  servicesButtonText: string;
  /**
   * Своё фото первого экрана (путь /api/content/image/hero-desktop или любой URL).
   * Пустая строка = стандартное фото из сборки сайта.
   */
  desktopImage: string;
  /** То же для мобильной версии. */
  mobileImage: string;
  /** alt-текст фото (для поисковиков и доступности). */
  altText: string;
}

export interface ServicesContent {
  title: string;
  subtitle: string;
  items: {
    title: string;
    description: string;
    features: string[];
  }[];
}

export interface BenefitsContent {
  title: string;
  subtitle: string;
  items: {
    title: string;
    description: string;
  }[];
}

export interface CoverageContent {
  /**
   * visible — блок виден посетителям,
   * seo-only — скрыт визуально (sr-only), но остаётся в HTML для поисковиков,
   * hidden — полностью скрыт.
   */
  mode: CoverageMode;
  title: string;
  subtitle: string;
  cities: {
    name: string;
    note: string;
  }[];
  /** Текст перед телефоном (внизу блока). */
  morePrefix: string;
  phoneLabel: string;
  phoneHref: string;
}

export interface FormContent {
  title: string;
  subtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  serviceLabel: string;
  servicePlaceholder: string;
  addressLabel: string;
  addressPlaceholder: string;
  commentLabel: string;
  commentPlaceholder: string;
  /** Текст согласия перед ссылкой на политику. */
  consentText: string;
  privacyLinkText: string;
  /** Текст перед телефоном внизу формы. */
  callUsPrefix: string;
  phoneValue: string;
  phoneHref: string;
  serviceOptions: {
    /** Код услуги — менять не рекомендуется (по нему сохраняются заявки). */
    value: string;
    label: string;
  }[];
  submitLabel: string;
  submittingLabel: string;
  successTitle: string;
  successDescription: string;
  successToastTitle: string;
  toastDescription: string;
}

export interface ContactContent {
  title: string;
  subtitle: string;
  items: {
    title: string;
    value: string;
    /** Пусто — текст без ссылки. */
    href: string;
  }[];
}

export interface FooterContent {
  companyTitle: string;
  companyDescription: string;
  servicesTitle: string;
  servicesLinks: NavLink[];
  contactsTitle: string;
  contactsLinks: NavLink[];
  /** В тексте можно использовать {year} — подставится текущий год. */
  copyrightText: string;
  developedByText: string;
  studioName: string;
  studioHref: string;
  requisites: string;
  privacyText: string;
  privacyHref: string;
}

export interface HomeContent {
  seo: SeoContent;
  header: HeaderContent;
  hero: HeroContent;
  services: ServicesContent;
  benefits: BenefitsContent;
  coverage: CoverageContent;
  form: FormContent;
  contact: ContactContent;
  footer: FooterContent;
}

/** Ограничения, чтобы в БД не попадали гигантские/вредные строки. */
export const CONTENT_LIMITS = {
  maxStringLength: 20_000,
  maxArrayItems: 40,
} as const;

/** Перечисляемые строковые поля — принимают только значения из списка. */
export const CONTENT_ENUMS: Record<string, readonly string[]> = {
  "coverage.mode": ["visible", "seo-only", "hidden"],
};

export const DEFAULT_CONTENT: HomeContent = {
  seo: {
    brandName: "Обзор71",
    title:
      "Обзор71 — установка и ремонт домофонов в Богородицке, Щёкино и Ефремове",
    description:
      "Обзор71 (ИП Бухтеев) — домофонная служба в Тульской области: установка, ремонт и обслуживание домофонов и видеодомофонов в Богородицке, Щёкино, Ефремове. Выезд мастера, гарантия. ☎ +7 (905) 629-87-08",
    keywords:
      "домофон, установка домофона, ремонт домофона, видеодомофон, домофонная служба, Обзор71, обзор 71, ИП Бухтеев, домофон Богородицк, домофон Щёкино, домофон Ефремов, Тульская область",
  },
  header: {
    logoTitle: "Домофонная служба",
    logoSubtitle: "ИП Бухтеев · Обзор71",
    nav: [
      { label: "Услуги", href: "#services" },
      { label: "Контакты", href: "#contact" },
    ],
    ctaText: "Оставить заявку",
  },
  hero: {
    requestButtonText: "Оставить заявку",
    servicesButtonText: "Наши услуги",
    desktopImage: "",
    mobileImage: "",
    altText: "",
  },
  services: {
    title: "Наши услуги",
    subtitle: "Комплексные решения для вашей безопасности и комфорта",
    items: [
      {
        title: "Установка домофонов",
        description:
          "Подберём и смонтируем систему под ваш дом — от одной квартиры до целого подъезда.",
        features: [
          "Видеодомофоны",
          "Аудиодомофоны",
          "IP-домофоны",
          "Многоквартирные системы",
        ],
      },
      {
        title: "Ремонт и обслуживание",
        description:
          "Быстро найдём причину неисправности и вернём систему в строй с гарантией на работу.",
        features: [
          "Диагностика неисправностей",
          "Замена компонентов",
          "Настройка системы",
          "Профилактика",
        ],
      },
    ],
  },
  benefits: {
    title: "Почему выбирают нас",
    subtitle: "Профессиональный подход к каждому заказу",
    items: [
      {
        title: "Гарантия качества",
        description:
          "Все работы выполняются с последующим обслуживанием. Используем только проверенное оборудование.",
      },
      {
        title: "Быстрое устранение проблем",
        description:
          "Устраняем неисправности в течение 3 рабочих дней с момента обращения.",
      },
      {
        title: "Работаем официально",
        description: "Заключаем договор на выполнение работ.",
      },
    ],
  },
  coverage: {
    mode: "seo-only",
    title:
      "Установка и ремонт домофонов в Богородицке, Щёкино и Ефремове",
    subtitle:
      "ИП Бухтеев — домофонная служба в Тульской области. Устанавливаем, ремонтируем и обслуживаем домофоны, видеодомофоны и подъездные домофонные системы — от квартирной трубки до вызывной панели на подъезде.",
    cities: [
      {
        name: "Богородицк",
        note: "Установка и ремонт домофонов, выезд мастера по городу и району",
      },
      {
        name: "Щёкино",
        note: "Домофоны и видеодомофоны в квартирах, домах и на подъездах",
      },
      {
        name: "Ефремов",
        note: "Обслуживание и ремонт домофонных систем, выезд мастера",
      },
    ],
    morePrefix:
      "Работаем и в других населённых пунктах Тульской области. Уточнить выезд в ваш город можно по телефону: ",
    phoneLabel: "+7 (905) 629-87-08",
    phoneHref: "tel:+79056298708",
  },
  form: {
    title: "Заявка на обслуживание",
    subtitle:
      "Заполните форму — и мы вам перезвоним. Отвечаем в рабочие дни, с 10:00 до 16:00. Заявки, оставленные после 16:00, обработаем на следующий день.",
    nameLabel: "Ваше имя",
    namePlaceholder: "Иван",
    phoneLabel: "Телефон",
    phonePlaceholder: "+7 (___) ___-__-__",
    serviceLabel: "Тип заявки",
    servicePlaceholder: "Выберите услугу",
    addressLabel: "Адрес",
    addressPlaceholder: "г. Город, ул. Название, д. 1, кв. 1",
    commentLabel: "Комментарий (необязательно)",
    commentPlaceholder:
      "Опишите проблему или пожелания — так мы приедем подготовленными",
    consentText: "Я согласен на обработку персональных данных и принимаю ",
    privacyLinkText: "политику конфиденциальности",
    callUsPrefix: "Или позвоните напрямую: ",
    phoneValue: "+7 (905) 629-87-08",
    phoneHref: "tel:+79056298708",
    serviceOptions: [
      { value: "install", label: "Установка домофона" },
      { value: "repair", label: "Ремонт / не работает" },
      { value: "maintenance", label: "Обслуживание" },
      { value: "consult", label: "Консультация" },
    ],
    submitLabel: "Отправить заявку",
    submittingLabel: "Отправляем…",
    successTitle: "Спасибо, заявка принята!",
    successDescription:
      "Мы уже получили её и перезвоним в рабочее время: будни с 10:00 до 16:00.",
    successToastTitle: "Заявка отправлена!",
    toastDescription:
      "Перезвоним в рабочее время: будни с 10:00 до 16:00.",
  },
  contact: {
    title: "Контакты",
    subtitle: "Свяжитесь с нами удобным способом",
    items: [
      {
        title: "Телефон",
        value: "+7 (905) 629-87-08",
        href: "tel:+79056298708",
      },
      {
        title: "Режим работы",
        value: "Пн-Пт: 9:00 - 18:00",
        href: "",
      },
    ],
  },
  footer: {
    companyTitle: "Домофонная служба | ИП Бухтеев",
    companyDescription:
      "Профессиональная установка и ремонт домофонных систем с гарантией качества.",
    servicesTitle: "Услуги",
    servicesLinks: [
      { label: "Установка домофонов", href: "#services" },
      { label: "Ремонт и обслуживание", href: "#services" },
      { label: "Оставить заявку", href: "#request-form" },
    ],
    contactsTitle: "Контакты",
    contactsLinks: [
      { label: "+7 (905) 629-87-08", href: "tel:+79056298708" },
      { label: "info@domofon-service.ru", href: "mailto:info@domofon-service.ru" },
    ],
    copyrightText:
      "© {year} Обзор71 — ИП Бухтеев. Все права защищены.",
    developedByText: "Разработано в",
    studioName: "MP Web Studio",
    studioHref: "https://mp-webstudio.ru",
    requisites:
      "ИП Бухтеев Сергей Валерьевич · ИНН 711610551800 · ОГРНИП 309715404200227",
    privacyText: "Политика конфиденциальности",
    privacyHref: "/privacy",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Глубокая копия JSON-совместимой структуры (дефолты — только примитивы и массивы). */
export function cloneContent<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Накладывает произвольный «сырой» объект поверх шаблона-дефолта:
 * принимаются только те поля и типы, которые есть в дефолте; всё лишнее
 * отбрасывается. Используется сервером при сохранении и чтении контента.
 */
export function sanitizeContent(input: unknown): HomeContent {
  return sanitizeNode(DEFAULT_CONTENT, input, []) as HomeContent;
}

function sanitizeNode(
  template: unknown,
  value: unknown,
  path: string[],
): unknown {
  const key = path.join(".");

  if (typeof template === "string") {
    if (typeof value === "string") {
      const max = CONTENT_LIMITS.maxStringLength;
      if (key in CONTENT_ENUMS) {
        const allowed = CONTENT_ENUMS[key];
        return allowed.includes(value) ? value : template;
      }
      return value.length > max ? value.slice(0, max) : value;
    }
    return template;
  }

  if (typeof template === "boolean") {
    return typeof value === "boolean" ? value : template;
  }

  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return cloneContent(template);
    const elementTemplate = template[0];
    const max = CONTENT_LIMITS.maxArrayItems;
    const out: unknown[] = [];
    for (const element of value.slice(0, max)) {
      if (elementTemplate === undefined) {
        if (typeof element === "string") out.push(element.slice(0, CONTENT_LIMITS.maxStringLength));
        else if (isRecord(element)) out.push(element);
      } else {
        const cleaned = sanitizeNode(elementTemplate, element, [...path, "0"]);
        // Убираем пустые элементы списков строк (например, лишние пункты списка)
        if (typeof elementTemplate === "string") {
          if (typeof cleaned === "string" && cleaned !== "") out.push(cleaned);
        } else {
          out.push(cleaned);
        }
      }
    }
    return out;
  }

  if (isRecord(template)) {
    if (!isRecord(value)) return cloneContent(template);
    const out: Record<string, unknown> = cloneContent(template);
    for (const childKey of Object.keys(template)) {
      if (childKey in value) {
        out[childKey] = sanitizeNode(template[childKey], value[childKey], [
          ...path,
          childKey,
        ]);
      }
    }
    return out;
  }

  return cloneContent(template);
}

/** Список секций для вкладок админки-редактора (порядок = порядку на странице). */
export const HOME_SECTIONS: {
  key: keyof HomeContent;
  title: string;
  description: string;
}[] = [
  {
    key: "seo",
    title: "Поисковая выдача",
    description:
      "Заголовок и описание, которые видят пользователи в Яндекс и Google по запросу «Обзор71».",
  },
  {
    key: "header",
    title: "Шапка сайта",
    description: "Название, подпись, пункты меню и кнопка в верхней панели.",
  },
  {
    key: "hero",
    title: "Первый экран",
    description:
      "Фото на весь экран и кнопки под ним. Фото можно заменить своим — оно сохранится отдельно.",
  },
  {
    key: "services",
    title: "Наши услуги",
    description: "Блок с двумя карточками услуг и их пунктами.",
  },
  {
    key: "benefits",
    title: "Почему выбирают нас",
    description: "Три преимущества (гарантия, скорость, официально).",
  },
  {
    key: "coverage",
    title: "Города работы",
    description:
      "SEO-блок о городах: сейчас скрыт визуально, но виден поисковикам (sr-only).",
  },
  {
    key: "form",
    title: "Форма заявки",
    description:
      "Все надписи формы: поля, подсказки, список услуг, сообщение об успехе.",
  },
  {
    key: "contact",
    title: "Контакты",
    description: "Карточки «Телефон» и «Режим работы» внизу страницы.",
  },
  {
    key: "footer",
    title: "Подвал",
    description: "Тексты и ссылки в самом низу страницы, включая копирайт.",
  },
];
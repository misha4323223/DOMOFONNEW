import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { storage } from "./storage";
import {
  insertLeadSchema,
  leadPartsDiff,
  normalizeLeadParts,
  normalizeRoutePlan,
  parseRoutePlan,
  serializeRoutePlan,
  type Lead,
  type LeadPart,
  type LeadPartDelta,
} from "@shared/schema";
import { SERVICE_LABELS } from "@shared/services";
import { notifyNewLead, notifyNewReview, notifyChatMessage } from "./push";
import {
  saveDeviceToken,
  removeDeviceToken,
  type StockItemPatch,
} from "./ydb";
import { recognizeHandwritten } from "./vision";
import { checkRussianText, SPELLCHECK_MAX_LENGTH } from "./spellcheck";
import { resolveGeoPlan, type GeoStopInput } from "./geo";
import { parseCandidates, parseDictation } from "./parse";
import {
  sanitizeContent,
  HERO_IMAGE_KEYS,
  type HomeContent,
} from "@shared/content";
import {
  pagePath,
  sanitizePages,
  visiblePages,
  type SitePage,
} from "@shared/pages";
import { sanitizePrivacy } from "@shared/privacy";

// --- Контент главной страницы (глубокий редактор в админке) ---
// Хранится в key/value-таблице настроек одним JSON-документом.
// Фото первого экрана — отдельными ключами (у записи YDB есть лимит ~400 КБ,
// поэтому фото не кладём внутрь JSON с текстами).
const CONTENT_SETTING_KEY = "content:home";
// Маршрут на день — тоже один JSON-документ в настройках (см. /api/admin/route).
const ROUTE_SETTING_KEY = "route:plan";
// Дополнительные страницы сайта (/p/<slug>) и текст страницы политики.
const PAGES_SETTING_KEY = "pages:site";
const PRIVACY_SETTING_KEY = "content:privacy";
// Фото внутри страниц: ключ в настройках — image:page:<id>, публичный адрес —
// /api/content/page-image/<id>.
const PAGE_IMAGE_SETTING_PREFIX = "image:page:";
const PAGE_IMAGE_ID_RE = /^[0-9a-f]{16}$/;
// Главный адрес сайта — нужен для абсолютных ссылок в sitemap.xml.
const SITE_ORIGIN = "https://obzor71.ru";
const IMAGE_SETTING_PREFIX = "image:";
// Лимит data-url фото: ~400 КБ на запись YDB; клиент сжимает фото до webp.
const MAX_IMAGE_DATA_URL_LENGTH = 400_000;

const IMAGE_DATA_URL_RE = /^data:image\/(webp|jpeg|png);base64,/i;
const IMAGE_DATA_URL_BODY_RE = /^data:(image\/[a-z+]+);base64,([\s\S]+)$/i;

function isHeroImageKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    (HERO_IMAGE_KEYS as readonly string[]).includes(key)
  );
}

function imageSettingKey(key: string): string {
  return `${IMAGE_SETTING_PREFIX}${key}`;
}

// --- Админка: простая авторизация по паролю ---
// Пароль задаётся переменной окружения ADMIN_PASSWORD.
// Если не задан — используется пароль по умолчанию (выведем предупреждение).
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0
    ? process.env.ADMIN_PASSWORD
    : "domofon2026";
const ADMIN_COOKIE = "admin_token";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

/**
 * Stateless-токены сессий: подпись HMAC(SHA-256) от пароля + срок жизни.
 * Serverless Containers крутит НЕСКОЛЬКО инстансов — хранить сессии в памяти
 * нельзя (запросы из одного браузера попадают на разные инстансы и получают 401).
 * Токен вида: "<expiresAt>.<nonce>.<hmac>" — проверяется на любом инстансе.
 */
function signSession(payload: string): string {
  return createHmac("sha256", ADMIN_PASSWORD).update(payload).digest("hex");
}

function issueToken(): string {
  const payload = `${Date.now() + SESSION_TTL_MS}.${randomBytes(24).toString("hex")}`;
  return `${payload}.${signSession(payload)}`;
}

function verifyToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  if (!/^\d+$/.test(expiresAt) || !/^[0-9a-f]+$/.test(nonce)) return false;
  const expected = signSession(`${expiresAt}.${nonce}`);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expiresAt) > Date.now();
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

/**
 * Токен сессии: из заголовка X-Admin-Token (так ходит мобильное приложение —
 * Yandex API Gateway не пропускает заголовок Authorization в интеграцию)
 * или из cookie admin_token (браузерная админка).
 */
function getSessionToken(req: Request): string | undefined {
  const custom = req.headers["x-admin-token"];
  if (typeof custom === "string" && custom.trim()) return custom.trim();
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return getCookie(req, ADMIN_COOKIE);
}

function isAuthed(req: Request): boolean {
  const token = getSessionToken(req);
  if (!token) return false;
  return verifyToken(token);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAuthed(req)) {
    return res.status(401).json({ message: "Не авторизован" });
  }
  next();
}


/**
 * Отправка уведомления о новой заявке в личные сообщения ВКонтакте.
 *
 * Требуется настроить сообщество ВК:
 *   1. vk.com/groups → "Создать сообщество" → "Сообщество по интересам (предприятие)"
 *   2. Управление → Работа с API → Ключи доступа → "Создать ключ"
 *      (отметить право "Сообщения")
 *   3. ВАЖНО: владелец должен ОДИН РАЗ написать сообществу
 *      (своему же сообществу), иначе сообщество не сможет писать ему первым.
 *
 * Затем задать в окружении:
 *   VK_GROUP_TOKEN — сервисный ключ сообщества
 *   VK_PEER_ID     — id пользователя (или peer_id диалога), куда слать заявки
 */
async function sendLeadToVk(lead: Lead): Promise<void> {
  const token = process.env.VK_GROUP_TOKEN;
  const peerId = process.env.VK_PEER_ID;
  if (!token || !peerId) {
    console.log("VK не настроен (нет VK_GROUP_TOKEN/VK_PEER_ID), заявка сохранена локально.");
    return;
  }

  const lines = [
    "📩 Новая заявка с сайта",
    `👤 Имя: ${lead.name}`,
    `📞 Телефон: ${lead.phone}`,
    `🛠 Услуга: ${SERVICE_LABELS[lead.service] ?? lead.service}`,
    `📍 Адрес: ${lead.address}`,
  ];
  if (lead.comment) {
    lines.push(`💬 Комментарий: ${lead.comment}`);
  }

  try {
    const body = new URLSearchParams({
      access_token: token,
      user_id: peerId,
      message: lines.join("\n"),
      random_id: String(Date.now()),
      v: "5.199",
    });
    const res = await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json();
    if (data.error) {
      console.error("VK API error:", JSON.stringify(data.error));
    } else {
      console.log("Заявка отправлена в ВК, message_id:", data.response);
    }
  } catch (err) {
    // Не роняем обработку заявки из-за проблем с ВК
    console.error("Не удалось отправить заявку в ВК:", err);
  }
}

/**
 * Express 4 сам не ловит reject'ы асинхронных обработчиков — необработанный
 * промис роняет весь процесс (Serverless Containers отдаёт 502). Оборачиваем
 * каждый async-роут, чтобы ошибка уходила в error-middleware и клиент получал
 * JSON-ответ, а контейнер оставался живым.
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Карта сайта: главная, политика и все видимые страницы из админки.
 * Новые страницы попадают в sitemap сразу после сохранения — иначе Яндекс
 * находил бы их только по ссылкам и сильно позже.
 */
function buildSitemap(pages: SitePage[]): string {
  const lastmod = new Date().toISOString().slice(0, 10);
  const entries = [
    { loc: `${SITE_ORIGIN}/`, changefreq: "weekly", priority: "1.0" },
    { loc: `${SITE_ORIGIN}/privacy`, changefreq: "yearly", priority: "0.3" },
    ...pages.map((page) => ({
      loc: `${SITE_ORIGIN}${pagePath(page.slug)}`,
      changefreq: "monthly",
      priority: "0.6",
    })),
  ];

  const urls = entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${entry.loc.replace(/&/g, "&amp;")}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`,
    )
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

export async function registerRoutes(app: Express): Promise<Server> {
  if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      "ADMIN_PASSWORD не задан — админка работает с паролем по умолчанию. Задайте ADMIN_PASSWORD в окружении контейнера!",
    );
  }

  // --- Админка: вход/выход/проверка ---
  app.post("/api/admin/login", (req: Request, res: Response) => {
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (!password) {
      return res.status(400).json({ message: "Введите пароль" });
    }
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ message: "Неверный пароль" });
    }
    const token = issueToken();
    res.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    return res.json({ ok: true, token });
  });

  app.post("/api/admin/logout", (_req: Request, res: Response) => {
    // Токен stateless — отозвать на сервере нельзя, просто стираем cookie.
    res.clearCookie(ADMIN_COOKIE, { path: "/" });
    return res.json({ ok: true });
  });

  app.get("/api/admin/me", (req: Request, res: Response) => {
    return res.json({ authed: isAuthed(req) });
  });

  // Распознавание фотографии блокнота с заявками (Yandex Vision OCR, рукописный текст)
  app.post("/api/admin/scan", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const image = typeof req.body?.image === "string" ? req.body.image : "";
    const mimeType =
      req.body?.mimeType === "PNG" ? ("PNG" as const) : ("JPEG" as const);
    if (!image) {
      return res.status(400).json({ message: "Нет изображения" });
    }
    // Ограничение: до ~8 МБ в base64 (Vision принимает до 10 МБ файла)
    if (image.length > 11_000_000) {
      return res.status(400).json({ message: "Изображение слишком большое" });
    }
    try {
      const { fullText, lines } = await recognizeHandwritten(image, mimeType);
      const candidates = parseCandidates(lines);
      return res.json({ fullText, lines, candidates });
    } catch (err) {
      console.error("Vision OCR error:", err);
      return res.status(502).json({
        message: "Не удалось распознать текст (Yandex Vision)",
      });
    }
  }));

  // Разбор надиктованной фразы в поля заявки (голосовое создание заявки).
  // Распознаёт текст само устройство (Android SpeechRecognizer), а раскладку
  // по полям делает сервер — тем же правилам, что и на странице блокнота.
  app.post("/api/admin/parse", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ message: "Пустой текст диктовки" });
    }
    if (text.length > 4000) {
      return res.status(400).json({ message: "Слишком длинная диктовка" });
    }
    return res.json({ text, fields: parseDictation(text) });
  }));

  // Проверка орфографии текстов сайта и ответов на отзывы. Вызывается только
  // по явному действию администратора: текст уходит на внешний сервис, поэтому
  // в заявках и заметках (там адреса и телефоны клиентов) мы её не предлагаем.
  app.post("/api/admin/spellcheck", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!text.trim()) {
      return res.json({ issues: [] });
    }
    if (text.length > SPELLCHECK_MAX_LENGTH) {
      return res.status(400).json({
        message: `Текст длиннее ${SPELLCHECK_MAX_LENGTH} символов — проверить нельзя`,
      });
    }
    try {
      const issues = await checkRussianText(text);
      return res.json({ issues });
    } catch (err) {
      console.error("Проверка орфографии не удалась:", err);
      return res.status(502).json({
        message:
          err instanceof Error && err.name === "TimeoutError"
            ? "Сервис проверки не ответил, попробуйте позже"
            : "Не удалось проверить текст (нужен интернет)",
      });
    }
  }));

  // Публичный контент главной страницы — читает и сайт, и админка-редактор
  app.get("/api/content", asyncHandler(async (_req: Request, res: Response) => {
    const saved = await storage.getSetting(CONTENT_SETTING_KEY);
    let overrides: unknown = {};
    if (saved) {
      try {
        overrides = JSON.parse(saved.value);
      } catch {
        // Битые данные не должны ронять сайт — используем дефолты
        console.error("Контент сайта повреждён, используем значения по умолчанию");
      }
    }
    const content = sanitizeContent(overrides);
    // max-age=0: правки из админки видны на сайте сразу после перезагрузки
    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    return res.json({ content, updatedAt: saved?.updatedAt ?? null });
  }));

  // Сохранение контента из редактора админки
  app.put("/api/admin/content", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const content: unknown = req.body?.content;
    if (typeof content !== "object" || content === null) {
      return res.status(400).json({ message: "Некорректные данные контента" });
    }
    const clean = sanitizeContent(content) as HomeContent;
    await storage.setSetting(CONTENT_SETTING_KEY, JSON.stringify(clean));
    const updatedAt = new Date().toISOString();
    return res.json({ ok: true, content: clean, updatedAt });
  }));

  // Загрузка своего фото для первого экрана (data-url, сжатый webp/jpeg/png)
  app.put("/api/admin/content/image", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const key = req.body?.key;
    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
    if (!isHeroImageKey(key)) {
      return res.status(400).json({ message: "Неизвестный ключ изображения" });
    }
    if (!IMAGE_DATA_URL_RE.test(dataUrl)) {
      return res.status(400).json({ message: "Поддерживаются фото webp, jpeg или png" });
    }
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return res.status(400).json({
        message: "Фото слишком большое — загрузите файл поменьше (до ~300 КБ)",
      });
    }
    await storage.setSetting(imageSettingKey(key), dataUrl);
    return res.json({ ok: true, url: `/api/content/image/${key}` });
  }));

  // Удаление загруженного фото (вернуть стандартное из сборки)
  app.delete("/api/admin/content/image/:key", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isHeroImageKey(key)) {
      return res.status(400).json({ message: "Неизвестный ключ изображения" });
    }
    await storage.removeSetting(imageSettingKey(key));
    return res.json({ ok: true });
  }));

  // Отдача загруженного фото по публичному адресу
  app.get("/api/content/image/:key", asyncHandler(async (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isHeroImageKey(key)) {
      return res.status(404).json({ message: "Изображение не найдено" });
    }
    const saved = await storage.getSetting(imageSettingKey(key));
    if (!saved) {
      return res.status(404).json({ message: "Изображение не найдено" });
    }
    const match = IMAGE_DATA_URL_BODY_RE.exec(saved.value);
    if (!match) {
      return res.status(500).json({ message: "Изображение повреждено" });
    }
    const mime = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], "base64");
    res.set("Content-Type", mime);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(buffer);
  }));

  // --- Дополнительные страницы сайта (конструктор в админке) ---
  // Страницы лежат одним JSON-документом в таблице настроек (ключ pages:site),
  // фото — отдельными ключами. Миграций БД не требуется; в веб-админке
  // появился раздел «Страницы», на сайте они открываются по /p/<slug>.

  /** Прочитать JSON-документ из настроек: нет записи или битые данные → undefined. */
  async function readSettingJson(key: string): Promise<unknown> {
    const saved = await storage.getSetting(key);
    if (!saved) return undefined;
    try {
      return JSON.parse(saved.value);
    } catch {
      console.error(`Настройка ${key} повреждена, используем значения по умолчанию`);
      return undefined;
    }
  }

  async function loadPages(): Promise<SitePage[]> {
    return sanitizePages(await readSettingJson(PAGES_SETTING_KEY));
  }

  // Страницы для посетителей — только видимые (скрытые видны в админке).
  app.get("/api/pages", asyncHandler(async (_req: Request, res: Response) => {
    const pages = visiblePages(await loadPages());
    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    return res.json({ pages });
  }));

  // Все страницы, включая скрытые — для редактора в админке.
  app.get("/api/admin/pages", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    return res.json({ pages: await loadPages() });
  }));

  app.put("/api/admin/pages", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const pages = sanitizePages(req.body?.pages);
    await storage.setSetting(PAGES_SETTING_KEY, JSON.stringify(pages));
    return res.json({ ok: true, pages });
  }));

  // Фото внутри страницы: тот же формат, что у фото первого экрана (data-url
  // сжатого webp/jpeg/png), потому что лимит записи YDB ~400 КБ.
  app.put("/api/admin/pages/image", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
    if (!IMAGE_DATA_URL_RE.test(dataUrl)) {
      return res.status(400).json({ message: "Поддерживаются фото webp, jpeg или png" });
    }
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return res.status(400).json({
        message: "Фото слишком большое — загрузите файл поменьше (до ~300 КБ)",
      });
    }
    const id = randomBytes(8).toString("hex");
    await storage.setSetting(`${PAGE_IMAGE_SETTING_PREFIX}${id}`, dataUrl);
    return res.json({ url: `/api/content/page-image/${id}` });
  }));

  // Удаление фото страницы (когда админ убрал его из блока).
  app.delete("/api/admin/pages/image/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!PAGE_IMAGE_ID_RE.test(id)) {
      return res.status(400).json({ message: "Неизвестное изображение" });
    }
    await storage.removeSetting(`${PAGE_IMAGE_SETTING_PREFIX}${id}`);
    return res.json({ ok: true });
  }));

  // Отдача фото страницы по публичному адресу.
  app.get("/api/content/page-image/:id", asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!PAGE_IMAGE_ID_RE.test(id)) {
      return res.status(404).json({ message: "Изображение не найдено" });
    }
    const saved = await storage.getSetting(`${PAGE_IMAGE_SETTING_PREFIX}${id}`);
    if (!saved) {
      return res.status(404).json({ message: "Изображение не найдено" });
    }
    const match = IMAGE_DATA_URL_BODY_RE.exec(saved.value);
    if (!match) {
      return res.status(500).json({ message: "Изображение повреждено" });
    }
    res.set("Content-Type", match[1].toLowerCase());
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(Buffer.from(match[2], "base64"));
  }));

  // --- Политика конфиденциальности (текст правит админ) ---
  app.get("/api/privacy", asyncHandler(async (_req: Request, res: Response) => {
    const content = sanitizePrivacy(await readSettingJson(PRIVACY_SETTING_KEY));
    // max-age=0: правки из админки видны на сайте сразу после перезагрузки
    res.set("Cache-Control", "public, max-age=0, must-revalidate");
    return res.json({ content });
  }));

  app.put("/api/admin/privacy", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const content = sanitizePrivacy(req.body?.content);
    await storage.setSetting(PRIVACY_SETTING_KEY, JSON.stringify(content));
    return res.json({ ok: true, content });
  }));

  // --- Карта сайта (sitemap.xml) ---
  // Собирается на сервере: главная, политика и все видимые страницы из админки.
  // Регистрируется до отдачи статики, поэтому перекрывает статический файл
  // client/public/sitemap.xml (тот остаётся запасным вариантом на случай,
  // если БД недоступна).
  app.get("/sitemap.xml", asyncHandler(async (_req: Request, res: Response) => {
    let pages: SitePage[] = [];
    try {
      pages = visiblePages(await loadPages());
    } catch (err) {
      console.error("Не удалось собрать sitemap по страницам сайта:", err);
    }
    res.type("application/xml");
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(buildSitemap(pages));
  }));

  // Регистрация push-токена мобильного приложения (Expo)
  app.post("/api/admin/push-token", requireAdmin, (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token || !token.startsWith("ExponentPushToken")) {
      return res.status(400).json({ message: "Некорректный push-токен" });
    }
    saveDeviceToken(token).catch((err) =>
      console.error("Не удалось сохранить push-токен:", err),
    );
    return res.json({ ok: true });
  });

  // Удаление push-токена (при выходе из приложения)
  app.delete("/api/admin/push-token", requireAdmin, (req: Request, res: Response) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) {
      return res.status(400).json({ message: "Некорректный push-токен" });
    }
    removeDeviceToken(token).catch((err) =>
      console.error("Не удалось удалить push-токен:", err),
    );
    return res.json({ ok: true });
  });

  // Список заявок — только для админа
  /**
   * Изменить остатки расходников по заявке (delta < 0 — списать).
   *
   * Позиция могла быть удалена из расходников — тогда изменение просто
   * пропускаем: сохранение заявки из-за этого падать не должно.
   */
  async function applyStockDeltas(deltas: LeadPartDelta[]): Promise<void> {
    for (const d of deltas) {
      if (!d.stockId || !d.delta) continue;
      try {
        const item = await storage.adjustStockItem(d.stockId, d.delta);
        if (!item) {
          console.warn(`[stock] Позиция «${d.name}» не найдена — остаток не изменён`);
        }
      } catch (err) {
        console.error(`[stock] Не удалось изменить остаток «${d.name}»:`, err);
      }
    }
  }

  app.get("/api/leads", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const leads = await storage.listLeads();
    return res.json(leads);
  }));

  // Обновление и удаление заявки — только для админа
  app.patch("/api/leads/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    // Источник и отметку «расходники списаны» админ менять не может:
    // источник проставляется при создании, а отметку ведёт сам сервер ниже.
    const parsed = insertLeadSchema.partial().omit({ source: true, partsDone: true }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Проверьте данные заявки", errors: parsed.error.flatten() });
    }
    const before = await storage.getLead(req.params.id);
    if (!before) {
      return res.status(404).json({ message: "Заявка не найдена" });
    }

    const patch = { ...parsed.data } as Record<string, unknown>;
    if (parsed.data.parts !== undefined) {
      patch.parts = normalizeLeadParts(parsed.data.parts);
    }

    // Расходники списываются с остатка в момент, когда заявку закрывают:
    // так это работает и для заявок, отправленных офлайн (очередь придёт позже).
    const nextParts: LeadPart[] =
      parsed.data.parts !== undefined ? normalizeLeadParts(parsed.data.parts) : before.parts;
    const nextStatus = parsed.data.status ?? before.status;
    const closed = nextStatus === "done";
    const wasClosed = before.partsDone === "1";

    // Что сделать с остатками: минус — списать, плюс — вернуть на склад
    const deltas: LeadPartDelta[] = [];
    if (closed && !wasClosed && nextParts.length > 0) {
      // Заявка закрыта впервые — списываем всё, что к ней прикреплено
      deltas.push(...nextParts.map((p) => ({ ...p, delta: -p.qty })));
      patch.partsDone = "1";
    } else if (closed && wasClosed) {
      // Уже была выполнена — если состав расходников потом поправили,
      // списываем только разницу
      deltas.push(...leadPartsDiff(before.parts, nextParts));
    } else if (!closed && wasClosed) {
      // Вернули заявку в работу — расходники возвращаются на остаток
      deltas.push(...before.parts.map((p) => ({ ...p, delta: p.qty })));
      patch.partsDone = "0";
    }

    // Сначала сохраняем заявку вместе с отметкой «списано», и только потом
    // меняем остатки: иначе повторная отправка той же правки (например, из
    // офлайн-очереди) списала бы расходники дважды.
    const lead = await storage.updateLead(req.params.id, patch);
    if (!lead) {
      return res.status(404).json({ message: "Заявка не найдена" });
    }
    await applyStockDeltas(deltas);
    return res.json(lead);
  }));

  app.delete("/api/leads/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    // Сначала читаем заявку: у выполненной списаны расходники, и при удалении
    // их надо вернуть на остаток — иначе они «пропадут» вместе с заявкой.
    const before = await storage.getLead(req.params.id);
    const deleted = await storage.deleteLead(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: "Заявка не найдена" });
    }
    // Удаляем заявку — привязанные заметки остаются, но отвязываются
    await storage.unlinkNotesByLead(req.params.id);
    if (before && before.partsDone === "1" && before.parts.length > 0) {
      await applyStockDeltas(before.parts.map((p) => ({ ...p, delta: p.qty })));
    }
    return res.status(204).send();
  }));

  // Ручное добавление заявки из админки или мобильного приложения
  app.post("/api/leads/admin", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Проверьте данные заявки", errors: parsed.error.flatten() });
    }
    const lead = await storage.createLead({ ...parsed.data, source: "admin" });
    // Оповестить телефоны (пожаробезопасно: ошибка push не ломает ответ)
    await notifyNewLead(lead).catch((err) =>
      console.error("Ошибка отправки push:", err),
    );
    return res.status(201).json(lead);
  }));

  // Заявки на обслуживание
  app.post("/api/leads", asyncHandler(async (req: Request, res: Response) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Проверьте правильность заполнения формы",
        errors: parsed.error.flatten(),
      });
    }

    // Заявки с публичной формы всегда «новые», источник — сайт
    const lead = await storage.createLead({ ...parsed.data, status: "new", source: "site" });

    console.log("Новая заявка получена:", JSON.stringify(lead, null, 2));

    // Push на телефоны и отправка в ВК (оба пожаробезопасны: при ошибке заявка уже сохранена)
    await Promise.allSettled([notifyNewLead(lead), sendLeadToVk(lead)]);

    return res.status(201).json(lead);
  }));

  // --- Маршрут на день (только мобильное приложение) ---
  // Порядок объезда собирает приложение (по городам и улицам), сервер его
  // только хранит — чтобы маршрут не потерялся при переустановке приложения
  // и был одинаковым на всех телефонах. В веб-админке интерфейса нет: там
  // по-прежнему только заявки.
  app.get("/api/admin/route", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const stored = await storage.getSetting(ROUTE_SETTING_KEY);
    return res.json(parseRoutePlan(stored?.value));
  }));

  app.put("/api/admin/route", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    // Сервер собирает и проверяет план сам: пустые id и повторы отбрасываем,
    // поэтому «мусор» в теле запроса не сломает маршрут.
    const plan = normalizeRoutePlan(req.body);
    await storage.setSetting(ROUTE_SETTING_KEY, serializeRoutePlan(plan));
    return res.json(plan);
  }));

  // --- Координаты и линия маршрута для карты в приложении ---
  // Приложение присылает точки в своём порядке, сервер отвечает координатами
  // и линией маршрута (OpenStreetMap: ключей, кабинетов и счетов не нужно).
  // Свежие адреса ищутся по правилам OSM — не чаще одного раза в секунду,
  // поэтому за один вызов делается не больше GEO_MAX_REQUESTS_PER_CALL
  // запросов (адрес может искаться несколькими вариантами), а в ответе
  // приходит remaining: приложение просто зовёт эндпоинт ещё раз, и точки
  // появляются на карте постепенно.
  app.post(
    "/api/admin/geo/plan",
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const raw = Array.isArray(req.body?.stops) ? req.body.stops : [];
      const stops: GeoStopInput[] = [];
      for (const item of raw) {
        const id = typeof item?.id === "string" ? item.id.trim() : "";
        const address =
          typeof item?.address === "string" ? item.address.replace(/\s+/g, " ").trim() : "";
        if (!id || !address) continue;
        const city =
          typeof item?.city === "string" ? item.city.replace(/\s+/g, " ").trim() : "";
        stops.push({ id, address: address.slice(0, 300), city: city.slice(0, 100) });
      }
      if (stops.length === 0) {
        return res.status(400).json({ message: "Не передано ни одного адреса" });
      }
      // refresh — ручное «Повторить» в приложении: заново проверяем адреса,
      // которые в прошлый раз не нашлись (кэш «не найдено» пропускаем).
      const refresh = req.body?.refresh === true;
      try {
        const result = await resolveGeoPlan(stops, { refresh });
        return res.json(result);
      } catch (err) {
        console.error("Не удалось определить координаты:", err);
        return res.status(502).json({ message: "Сервис карт не ответил, попробуйте позже" });
      }
    }),
  );

  // --- Заметки (только мобильное приложение) ---
  // Общие с заявками правила: X-Admin-Token, никакого UI в веб-админке.
  const NAME_MAX_LENGTH = 40;
  const NOTE_TEXT_MAX_LENGTH = 4000;
  const CHAT_TEXT_MAX_LENGTH = 2000;

  function cleanName(value: unknown): string {
    return typeof value === "string" && value.trim()
      ? value.trim().slice(0, NAME_MAX_LENGTH)
      : "Админ";
  }

  app.get("/api/notes", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const notes = await storage.listNotes();
    return res.json(notes);
  }));

  app.post("/api/notes", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ message: "Введите текст заметки" });
    }
    if (text.length > NOTE_TEXT_MAX_LENGTH) {
      return res.status(400).json({ message: "Заметка слишком длинная" });
    }
    const leadId =
      req.body?.leadId === null
        ? null
        : typeof req.body?.leadId === "string" && req.body.leadId.trim()
          ? req.body.leadId.trim()
          : undefined;
    const note = await storage.createNote({
      text,
      author: cleanName(req.body?.author),
      ...(leadId !== undefined ? { leadId } : {}),
    });
    return res.status(201).json(note);
  }));

  app.patch("/api/notes/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const patch: Record<string, string> = {};
    if (req.body?.text !== undefined) {
      const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
      if (!text) {
        return res.status(400).json({ message: "Текст заметки не может быть пустым" });
      }
      if (text.length > NOTE_TEXT_MAX_LENGTH) {
        return res.status(400).json({ message: "Заметка слишком длинная" });
      }
      patch.text = text;
    }
    if (req.body?.done !== undefined) {
      const done = req.body.done === "1" || req.body.done === true ? "1" : "0";
      patch.done = done;
    }
    if (req.body?.author !== undefined) {
      patch.author = cleanName(req.body.author);
    }
    // Привязка к заявке: строка — привязать, null — отвязать.
    if (req.body?.leadId !== undefined) {
      patch.leadId =
        req.body.leadId === null
          ? null
          : typeof req.body.leadId === "string" && req.body.leadId.trim()
            ? req.body.leadId.trim()
            : null;
    }
    const note = await storage.updateNote(req.params.id, patch);
    return note ? res.json(note) : res.status(404).json({ message: "Заметка не найдена" });
  }));

  app.delete("/api/notes/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const deleted = await storage.deleteNote(req.params.id);
    return deleted ? res.status(204).send() : res.status(404).json({ message: "Заметка не найдена" });
  }));

  // --- Расходники в машине мастера (только мобильное приложение) ---
  // Мастер ведёт остаток того, что лежит в машине. Списание и пополнение
  // идут дельтой (adjust), а не перезаписью числа — так правки с двух
  // телефонов не затирают друг друга.
  const STOCK_NAME_MAX = 60;
  const STOCK_UNIT_MAX = 12;
  const STOCK_NOTE_MAX = 200;
  const STOCK_MAX_QTY = 100_000;

  /** Количество из тела запроса: число или «1,5» строкой. Некорректное → undefined. */
  function stockQty(value: unknown): number | undefined {
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const n = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.min(Math.round(n * 1000) / 1000, STOCK_MAX_QTY);
  }

  app.get("/api/stock", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const items = await storage.listStockItems();
    return res.json(items);
  }));

  app.post("/api/stock", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name) {
      return res.status(400).json({ message: "Введите название позиции" });
    }
    if (name.length > STOCK_NAME_MAX) {
      return res.status(400).json({ message: "Название слишком длинное" });
    }
    const item = await storage.createStockItem({
      name,
      unit:
        typeof req.body?.unit === "string"
          ? req.body.unit.trim().slice(0, STOCK_UNIT_MAX)
          : undefined,
      qty: stockQty(req.body?.qty),
      minQty: stockQty(req.body?.minQty),
      note:
        typeof req.body?.note === "string"
          ? req.body.note.trim().slice(0, STOCK_NOTE_MAX)
          : undefined,
    });
    return res.status(201).json(item);
  }));

  app.patch("/api/stock/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const patch: StockItemPatch = {};
    if (req.body?.name !== undefined) {
      const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
      if (!name) {
        return res.status(400).json({ message: "Введите название позиции" });
      }
      if (name.length > STOCK_NAME_MAX) {
        return res.status(400).json({ message: "Название слишком длинное" });
      }
      patch.name = name;
    }
    if (req.body?.unit !== undefined) {
      patch.unit =
        typeof req.body.unit === "string"
          ? req.body.unit.trim().slice(0, STOCK_UNIT_MAX)
          : "";
    }
    if (req.body?.qty !== undefined) {
      const qty = stockQty(req.body.qty);
      if (qty === undefined) {
        return res.status(400).json({ message: "Некорректный остаток" });
      }
      patch.qty = qty;
    }
    if (req.body?.minQty !== undefined) {
      const minQty = stockQty(req.body.minQty);
      if (minQty === undefined) {
        return res.status(400).json({ message: "Некорректный минимум" });
      }
      patch.minQty = minQty;
    }
    if (req.body?.note !== undefined) {
      patch.note =
        typeof req.body.note === "string"
          ? req.body.note.trim().slice(0, STOCK_NOTE_MAX)
          : "";
    }
    const item = await storage.updateStockItem(req.params.id, patch);
    return item
      ? res.json(item)
      : res.status(404).json({ message: "Позиция не найдена" });
  }));

  // Списать (delta < 0) или добавить (delta > 0) к остатку.
  app.post(
    "/api/stock/:id/adjust",
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
      const delta = Number(req.body?.delta);
      if (!Number.isFinite(delta) || delta === 0) {
        return res.status(400).json({ message: "Укажите количество" });
      }
      if (Math.abs(delta) > STOCK_MAX_QTY) {
        return res.status(400).json({ message: "Слишком большое количество" });
      }
      const item = await storage.adjustStockItem(req.params.id, delta);
      return item
        ? res.json(item)
        : res.status(404).json({ message: "Позиция не найдена" });
    }),
  );

  app.delete("/api/stock/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const deleted = await storage.deleteStockItem(req.params.id);
    return deleted
      ? res.status(204).send()
      : res.status(404).json({ message: "Позиция не найдена" });
  }));

  // --- Чат между админами (только мобильное приложение) ---
  // Получение: ?after=<ISO-дата> — вернуть только сообщения новее этой даты.
  app.get("/api/chat/messages", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const after = typeof req.query.after === "string" ? req.query.after : undefined;
    const messages = await storage.listChatMessages(after);
    return res.json(messages);
  }));

  // Сколько сообщений чата ещё не прочитано. Якорь прочтения живёт на сервере,
  // поэтому счётчик одинаков на всех устройствах и не зависит от часов телефона.
  app.get("/api/chat/unread", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const unread = await storage.getChatUnread();
    return res.json(unread);
  }));

  // Явная пометка «все сообщения чата прочитаны»: сервер сдвигает якорь на
  // последнее сообщение, счётчик обнуляется и снова растёт только с новых.
  app.post("/api/chat/read", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const unread = await storage.markChatRead();
    return res.json(unread);
  }));

  // Фото в чате: сжатый data-url jpeg/png/webp. Лимит ~300 КБ base64
  // (у записи YDB свой лимит ~400 КБ, запас на остальные поля).
  const MAX_CHAT_IMAGE_LENGTH = 300_000;
  const CHAT_IMAGE_DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

  app.post("/api/chat/messages", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const image = typeof req.body?.image === "string" ? req.body.image.trim() : "";
    if (!text && !image) {
      return res.status(400).json({ message: "Введите текст сообщения или прикрепите фото" });
    }
    if (text.length > CHAT_TEXT_MAX_LENGTH) {
      return res.status(400).json({ message: "Сообщение слишком длинное" });
    }
    if (image) {
      if (image.length > MAX_CHAT_IMAGE_LENGTH) {
        return res.status(400).json({ message: "Фото слишком большое — прикрепите файл поменьше" });
      }
      if (!CHAT_IMAGE_DATA_URL_RE.test(image)) {
        return res.status(400).json({ message: "Некорректное изображение" });
      }
    }
    const message = await storage.sendChatMessage({
      sender: cleanName(req.body?.sender),
      address: typeof req.body?.address === "string" ? req.body.address.trim() : "",
      text,
      image: image || undefined,
    });
    // Push на телефоны админов (пожаробезопасно: ошибка не ломает отправку
    // сообщения — оно уже сохранено). Тап по уведомлению открывает чат.
    await notifyChatMessage(message).catch((err) =>
      console.error("Ошибка отправки push о сообщении:", err),
    );
    return res.status(201).json(message);
  }));

  app.patch("/api/chat/messages/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ message: "Введите текст сообщения" });
    }
    const updated = await storage.updateChatMessage(req.params.id, { text });
    if (!updated) {
      return res.status(404).json({ message: "Сообщение не найдено" });
    }
    return res.json(updated);
  }));

  app.delete("/api/chat/messages/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    await storage.deleteChatMessage(req.params.id);
    return res.json({ ok: true });
  }));

  // --- Отзывы клиентов ---
  // Публичная отправка отзыва с сайта: без авторизации, но с проверками.
  // Отзыв попадает в статус "new" — админ публикует его в админке.
  const REVIEW_NAME_MAX_LENGTH = 60;
  const REVIEW_CITY_MAX_LENGTH = 60;
  const REVIEW_TEXT_MAX_LENGTH = 2000;

  app.post("/api/reviews", asyncHandler(async (req: Request, res: Response) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const city = typeof req.body?.city === "string" ? req.body.city.trim() : "";
    const ratingRaw = typeof req.body?.rating === "string" ? req.body.rating.trim() : "";
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";

    if (!name) {
      return res.status(400).json({ message: "Укажите имя" });
    }
    if (name.length > REVIEW_NAME_MAX_LENGTH) {
      return res.status(400).json({ message: "Имя слишком длинное" });
    }
    if (city.length > REVIEW_CITY_MAX_LENGTH) {
      return res.status(400).json({ message: "Город слишком длинный" });
    }
    const rating = Number(ratingRaw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Оценка должна быть от 1 до 5" });
    }
    if (!text) {
      return res.status(400).json({ message: "Напишите текст отзыва" });
    }
    if (text.length > REVIEW_TEXT_MAX_LENGTH) {
      return res.status(400).json({ message: "Отзыв слишком длинный" });
    }

    const review = await storage.createReview({
      name,
      city,
      rating: String(rating),
      text,
    });

    // Уведомить админа push'ем — отзыв ждёт модерации (пожаробезопасно:
    // ошибка push не ломает ответ клиенту)
    await notifyNewReview(review).catch((err) =>
      console.error("Ошибка отправки push об отзыве:", err),
    );
    return res.status(201).json(review);
  }));

  // Опубликованные отзывы — читает сайт (без авторизации)
  app.get("/api/reviews", asyncHandler(async (_req: Request, res: Response) => {
    const reviews = await storage.listPublishedReviews();
    res.set("Cache-Control", "public, max-age=60");
    return res.json(reviews);
  }));

  // Все отзывы (включая на модерации) — только для админа
  app.get("/api/admin/reviews", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const reviews = await storage.listReviews();
    return res.json(reviews);
  }));

  // Правка отзыва админом: смена статуса ("new" → "published" / "hidden")
  // и/или ответ службы на отзыв (пустая строка — убрать ответ).
  const REVIEW_REPLY_MAX_LENGTH = 1000;

  app.patch("/api/admin/reviews/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const patch: { status?: "new" | "published" | "hidden"; reply?: string } = {};

    if (req.body?.status !== undefined) {
      const status = req.body.status;
      if (status !== "new" && status !== "published" && status !== "hidden") {
        return res.status(400).json({ message: "Некорректный статус" });
      }
      patch.status = status;
    }

    if (req.body?.reply !== undefined) {
      if (typeof req.body.reply !== "string") {
        return res.status(400).json({ message: "Ответ должен быть текстом" });
      }
      const reply = req.body.reply.trim();
      if (reply.length > REVIEW_REPLY_MAX_LENGTH) {
        return res.status(400).json({ message: "Ответ слишком длинный" });
      }
      patch.reply = reply;
    }

    if (patch.status === undefined && patch.reply === undefined) {
      return res.status(400).json({ message: "Нет изменений" });
    }

    const review = await storage.updateReview(req.params.id, patch);
    if (!review) {
      return res.status(404).json({ message: "Отзыв не найден" });
    }
    return res.json(review);
  }));

  app.delete("/api/admin/reviews/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    await storage.deleteReview(req.params.id);
    return res.json({ ok: true });
  }));

  const httpServer = createServer(app);

  return httpServer;
}
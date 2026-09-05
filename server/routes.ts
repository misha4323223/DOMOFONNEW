import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { storage } from "./storage";
import { insertLeadSchema, type Lead } from "@shared/schema";
import { SERVICE_LABELS } from "@shared/services";
import { notifyNewLead } from "./push";
import { saveDeviceToken, removeDeviceToken } from "./ydb";
import { recognizeHandwritten } from "./vision";
import { parseCandidates } from "./parse";
import {
  sanitizeContent,
  HERO_IMAGE_KEYS,
  type HomeContent,
} from "@shared/content";

// --- Контент главной страницы (глубокий редактор в админке) ---
// Хранится в key/value-таблице настроек одним JSON-документом.
// Фото первого экрана — отдельными ключами (у записи YDB есть лимит ~400 КБ,
// поэтому фото не кладём внутрь JSON с текстами).
const CONTENT_SETTING_KEY = "content:home";
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
  app.get("/api/leads", requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    const leads = await storage.listLeads();
    return res.json(leads);
  }));

  // Обновление и удаление заявки — только для админа
  app.patch("/api/leads/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const parsed = insertLeadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Проверьте данные заявки", errors: parsed.error.flatten() });
    }
    const lead = await storage.updateLead(req.params.id, parsed.data);
    return lead ? res.json(lead) : res.status(404).json({ message: "Заявка не найдена" });
  }));

  app.delete("/api/leads/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const deleted = await storage.deleteLead(req.params.id);
    return deleted ? res.status(204).send() : res.status(404).json({ message: "Заявка не найдена" });
  }));

  // Ручное добавление заявки из админки или мобильного приложения
  app.post("/api/leads/admin", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Проверьте данные заявки", errors: parsed.error.flatten() });
    }
    const lead = await storage.createLead(parsed.data);
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

    // Заявки с публичной формы всегда «новые» — статус управляется только админом
    const lead = await storage.createLead({ ...parsed.data, status: "new" });

    console.log("Новая заявка получена:", JSON.stringify(lead, null, 2));

    // Push на телефоны и отправка в ВК (оба пожаробезопасны: при ошибке заявка уже сохранена)
    await Promise.allSettled([notifyNewLead(lead), sendLeadToVk(lead)]);

    return res.status(201).json(lead);
  }));

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
    const note = await storage.createNote({ text, author: cleanName(req.body?.author) });
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
    const note = await storage.updateNote(req.params.id, patch);
    return note ? res.json(note) : res.status(404).json({ message: "Заметка не найдена" });
  }));

  app.delete("/api/notes/:id", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const deleted = await storage.deleteNote(req.params.id);
    return deleted ? res.status(204).send() : res.status(404).json({ message: "Заметка не найдена" });
  }));

  // --- Чат между админами (только мобильное приложение) ---
  // Получение: ?after=<ISO-дата> — вернуть только сообщения новее этой даты.
  app.get("/api/chat/messages", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const after = typeof req.query.after === "string" ? req.query.after : undefined;
    const messages = await storage.listChatMessages(after);
    return res.json(messages);
  }));

  app.post("/api/chat/messages", requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ message: "Введите текст сообщения" });
    }
    if (text.length > CHAT_TEXT_MAX_LENGTH) {
      return res.status(400).json({ message: "Сообщение слишком длинное" });
    }
    const message = await storage.sendChatMessage({
      sender: cleanName(req.body?.sender),
      address: typeof req.body?.address === "string" ? req.body.address.trim() : "",
      text,
    });
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

  const httpServer = createServer(app);

  return httpServer;
}
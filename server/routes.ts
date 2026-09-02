import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { insertLeadSchema, type Lead } from "@shared/schema";
import { SERVICE_LABELS } from "@shared/services";
import { notifyNewLead } from "./push";
import { saveDeviceToken, removeDeviceToken } from "./ydb";
import { recognizeHandwritten } from "./vision";
import { parseCandidates } from "./parse";

// --- Админка: простая авторизация по паролю ---
// Пароль задаётся переменной окружения ADMIN_PASSWORD.
// Если не задан — используется пароль по умолчанию (выведем предупреждение).
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0
    ? process.env.ADMIN_PASSWORD
    : "domofon2026";
const ADMIN_COOKIE = "admin_token";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 дней

// Токены сессий админа: token -> expiresAt (в памяти, подходит для одного контейнера)
const adminTokens = new Map<string, number>();

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
  const expiresAt = adminTokens.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    adminTokens.delete(token);
    return false;
  }
  return true;
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
    const token = randomBytes(32).toString("hex");
    adminTokens.set(token, Date.now() + SESSION_TTL_MS);
    res.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    return res.json({ ok: true, token });
  });

  app.post("/api/admin/logout", (req: Request, res: Response) => {
    const token = getSessionToken(req);
    if (token) adminTokens.delete(token);
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

  const httpServer = createServer(app);

  return httpServer;
}
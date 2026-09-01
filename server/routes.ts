import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { storage } from "./storage";
import { insertLeadSchema, type Lead } from "@shared/schema";

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

function isAuthed(req: Request): boolean {
  const token = getCookie(req, ADMIN_COOKIE);
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

export const SERVICE_LABELS: Record<string, string> = {
  install: "Установка домофона",
  repair: "Ремонт / не работает",
  maintenance: "Обслуживание",
  consult: "Консультация",
};

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
    return res.json({ ok: true });
  });

  app.post("/api/admin/logout", (req: Request, res: Response) => {
    const token = getCookie(req, ADMIN_COOKIE);
    if (token) adminTokens.delete(token);
    res.clearCookie(ADMIN_COOKIE, { path: "/" });
    return res.json({ ok: true });
  });

  app.get("/api/admin/me", (req: Request, res: Response) => {
    return res.json({ authed: isAuthed(req) });
  });

  // Список заявок — только для админа
  app.get("/api/leads", requireAdmin, async (_req: Request, res: Response) => {
    const leads = await storage.listLeads();
    return res.json(leads);
  });

  // Обновление и удаление заявки — только для админа
  app.patch("/api/leads/:id", requireAdmin, async (req: Request, res: Response) => {
    const parsed = insertLeadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Проверьте данные заявки", errors: parsed.error.flatten() });
    }
    const lead = await storage.updateLead(req.params.id, parsed.data);
    return lead ? res.json(lead) : res.status(404).json({ message: "Заявка не найдена" });
  });

  app.delete("/api/leads/:id", requireAdmin, async (req: Request, res: Response) => {
    const deleted = await storage.deleteLead(req.params.id);
    return deleted ? res.status(204).send() : res.status(404).json({ message: "Заявка не найдена" });
  });

  // Ручное добавление заявки из админки или мобильного приложения
  app.post("/api/leads/admin", requireAdmin, async (req: Request, res: Response) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Проверьте данные заявки", errors: parsed.error.flatten() });
    }
    const lead = await storage.createLead(parsed.data);
    return res.status(201).json(lead);
  });

  // Заявки на обслуживание
  app.post("/api/leads", async (req: Request, res: Response) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Проверьте правильность заполнения формы",
        errors: parsed.error.flatten(),
      });
    }

    const lead = await storage.createLead(parsed.data);

    console.log("Новая заявка получена:", JSON.stringify(lead, null, 2));

    // Отправка в ВК (пожаробезопасно: при ошибке заявка уже сохранена)
    await sendLeadToVk(lead);

    return res.status(201).json(lead);
  });

  const httpServer = createServer(app);

  return httpServer;
}
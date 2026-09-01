import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertLeadSchema, type Lead } from "@shared/schema";

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
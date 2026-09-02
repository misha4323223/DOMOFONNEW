import type { Lead } from "@shared/schema";
import { listDeviceTokens } from "./ydb";
import { SERVICE_LABELS } from "@shared/services";

/**
 * Отправка push-уведомлений о новой заявке через Expo Push API.
 *
 * Мобильное приложение (Expo) при входе регистрирует свой ExpoPushToken
 * на сервере (POST /api/admin/push-token). Когда приходит новая заявка,
 * сервер рассылает уведомление на все зарегистрированные устройства.
 *
 * Для доставки на Android в standalone-APK нужно настроить Firebase (FCM) —
 * см. README в папке mobile/.
 */

function buildMessage(lead: Lead): { title: string; body: string } {
  const service = SERVICE_LABELS[lead.service] ?? lead.service;
  const title = "📩 Новая заявка";
  const body = `${lead.name}, ${lead.phone} — ${service}${lead.address ? `, ${lead.address}` : ""}`;
  return { title, body };
}

/**
 * Рассылает push всем зарегистрированным устройствам.
 * Пожаробезопасно: при любой ошибке уведомление молча пропускается,
 * заявка к этому моменту уже сохранена в БД.
 */
export async function notifyNewLead(lead: Lead): Promise<void> {
  let tokens: string[];
  try {
    tokens = await listDeviceTokens();
  } catch (err) {
    console.error("Не удалось получить push-токены устройств:", err);
    return;
  }
  if (tokens.length === 0) return;

  const { title, body } = buildMessage(lead);

  // Expo Push API принимает до 100 токенов за запрос.
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: batch,
          title,
          body,
          sound: "default",
          // Android 8+: канал «default» создаётся при регистрации токена,
          // иначе система может молча выбросить уведомление.
          channelId: "default",
          priority: "high",
          data: { leadId: lead.id, screen: "leads" },
        }),
      });

      // ВАЖНО: Expo отвечает 200 даже когда токен отклонён — детальная причина
      // лежит в теле ответа (tickets). Читаем её и логируем по каждому токену,
      // чтобы видеть, почему уведомление не доставлено.
      const text = await res.text();
      let tickets: {
        status?: string;
        message?: string;
        details?: { error?: string };
        id?: string;
      }[] = [];
      try {
        const parsed = JSON.parse(text) as { data?: typeof tickets };
        tickets = parsed.data ?? [];
      } catch {
        // не JSON — залогируем сырой ответ ниже
      }

      let okCount = 0;
      for (const ticket of tickets) {
        if (ticket.status === "ok") {
          okCount++;
          continue;
        }
        console.error(
          `Push отклонён: ${ticket.message ?? "ошибка"}${ticket.details?.error ? ` (${ticket.details.error})` : ""}`,
        );
      }

      if (tickets.length > 0) {
        console.log(
          `Push: HTTP ${res.status}, принято ${okCount}/${tickets.length}`,
        );
      } else {
        console.error(`Expo Push API ответил ${res.status}: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      console.error("Не удалось отправить push:", err);
    }
  }
}

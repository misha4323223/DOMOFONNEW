import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  service: text("service").notNull(),
  address: text("address").notNull(),
  comment: text("comment"),
  createdAt: text("created_at").notNull().default(sql`now()`),
});

export const LEAD_STATUSES = ["new", "urgent", "done"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Откуда пришла заявка: с сайта (клиент) или добавлена вручную (админ). */
export const LEAD_SOURCES = ["site", "admin"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * Расходник, закреплённый за заявкой.
 *
 * Название и единица — «снимок» на момент прикрепления: если позицию потом
 * переименуют или удалят из расходников, в истории заявки всё останется читаемым.
 * Само списание идёт по stockId.
 */
export interface LeadPart {
  /** id позиции в расходниках (таблица stock). */
  stockId: string;
  /** Название позиции на момент прикрепления. */
  name: string;
  /** Единица измерения («шт», «м», «пара»). */
  unit: string;
  /** Сколько израсходовано на этой заявке. */
  qty: number;
}

/** Больше этого числа позиций к одной заявке не прикрепляем. */
export const LEAD_PARTS_MAX_ITEMS = 20;

/** Привести произвольное значение (тело запроса или JSON из БД) к списку позиций. */
export function normalizeLeadParts(value: unknown): LeadPart[] {
  if (!Array.isArray(value)) return [];
  const out: LeadPart[] = [];
  for (const raw of value.slice(0, LEAD_PARTS_MAX_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const stockId = typeof item.stockId === "string" ? item.stockId.trim() : "";
    if (!stockId) continue;
    const qty =
      typeof item.qty === "number" ? item.qty : Number(String(item.qty ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 80) : "";
    const unit =
      typeof item.unit === "string" && item.unit.trim()
        ? item.unit.trim().slice(0, 12)
        : "шт";
    out.push({
      stockId,
      name: name || "Позиция",
      unit,
      qty: Math.min(Math.round(qty * 1000) / 1000, 100_000),
    });
  }
  return out;
}

/** Разобрать список расходников из строки БД (JSON). Битое значение — пустой список. */
export function parseLeadParts(raw: unknown): LeadPart[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    return normalizeLeadParts(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Строка для хранения в БД (пусто — расходников нет). */
export function serializeLeadParts(parts: LeadPart[]): string {
  return parts.length ? JSON.stringify(parts) : "";
}

/**
 * Изменение остатка по одной позиции в тех же знаках, что и «adjust»:
 * delta < 0 — списать, delta > 0 — вернуть на остаток.
 */
export interface LeadPartDelta {
  stockId: string;
  name: string;
  unit: string;
  delta: number;
}

/**
 * Что ещё изменить на остатке, если состав расходников заявки поправили
 * у уже выполненной заявки: было · стало → дельта по каждой позиции.
 *
 * Например, панель была 2, стала 3 — вернуть ещё одну: delta = −1.
 */
export function leadPartsDiff(
  before: LeadPart[],
  after: LeadPart[],
): LeadPartDelta[] {
  const beforeById = new Map<string, LeadPart>();
  for (const p of before) beforeById.set(p.stockId, p);
  const diffs: LeadPartDelta[] = [];
  for (const p of after) {
    const prevQty = beforeById.get(p.stockId)?.qty ?? 0;
    const delta = prevQty - p.qty;
    if (delta !== 0) {
      diffs.push({ stockId: p.stockId, name: p.name, unit: p.unit, delta });
    }
    beforeById.delete(p.stockId);
  }
  // Позиции, которые из заявки убрали — списанное возвращаем на остаток
  beforeById.forEach((p) => {
    diffs.push({ stockId: p.stockId, name: p.name, unit: p.unit, delta: p.qty });
  });
  return diffs;
}

export const insertLeadSchema = createInsertSchema(leads)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    comment: z.string().nullish(),
    // Статус заявки: новая / срочно / выполнена
    status: z.enum(LEAD_STATUSES).default("new"),
    // Источник заявки: "site" (клиент с сайта) или "admin" (добавлена админом вручную).
    // Сервер всегда перекрывает это поле сам, клиент не может его подменить.
    source: z.enum(LEAD_SOURCES).optional(),
    // Заявка в архиве: "1" — убрана из активного списка (после выполнения),
    // "0" — активная. Меняется админом из мобильного приложения.
    archived: z.enum(["0", "1"]).optional(),
    // Расходники, израсходованные на заявке. Списываются с остатка,
    // когда заявку переводят в «Выполнена» (делает сервер, см. server/routes.ts).
    parts: z
      .array(
        z.object({
          stockId: z.string().min(1),
          name: z.string().optional(),
          unit: z.string().optional(),
          qty: z.number().positive(),
        }),
      )
      .max(LEAD_PARTS_MAX_ITEMS)
      .optional(),
    // "1" — расходники уже списаны. Поле служебное: клиент его не присылает
    // и не может подменить (сервер перекрывает сам).
    partsDone: z.enum(["0", "1"]).optional(),
  });

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect & {
  status: LeadStatus;
  source: LeadSource;
  /** "1" — заявка в архиве, "0" — активная. */
  archived: string;
  /** Расходники, закреплённые за заявкой. */
  parts: LeadPart[];
  /** "1" — расходники уже списаны с остатка, "0" — ещё нет. */
  partsDone: string;
};

/**
 * Маршрут на день — заявки в порядке объезда.
 *
 * Порядок собирает приложение (по городам, внутри города — по улицам и домам),
 * сервер только хранит план одним JSON-документом в key/value-таблице настроек
 * (ключ «route:plan»). Так маршрут переживает переустановку приложения и
 * одинаков на всех телефонах админов.
 *
 * Выполненные заявки в плане не помечаются: «сделано» — это статус самой
 * заявки, поэтому отметка не может разъехаться с реальностью.
 */
export interface RoutePlan {
  /** id заявок в порядке объезда. */
  stops: string[];
  /** Когда маршрут запущен (ISO); null — план ещё собирается. */
  startedAt: string | null;
  /** Когда план последний раз менялся (ISO). По нему выбираем свежую версию. */
  updatedAt: string;
}

/** Больше этого числа точек в один маршрут не собираем. */
export const ROUTE_MAX_STOPS = 50;

/** Пустой план: маршрут ещё не собирали. */
export function emptyRoutePlan(): RoutePlan {
  return { stops: [], startedAt: null, updatedAt: "" };
}

/** Привести произвольное значение (тело запроса или JSON из БД) к плану. */
export function normalizeRoutePlan(value: unknown): RoutePlan {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const stops: string[] = [];
  if (Array.isArray(raw.stops)) {
    for (const item of raw.stops) {
      const id = typeof item === "string" ? item.trim() : "";
      // Повторы в плане бессмысленны: одна заявка — одна точка
      if (!id || stops.includes(id)) continue;
      stops.push(id);
      if (stops.length >= ROUTE_MAX_STOPS) break;
    }
  }
  const startedAt =
    typeof raw.startedAt === "string" && raw.startedAt.trim()
      ? raw.startedAt.trim()
      : null;
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt.trim()
      : new Date().toISOString();
  return { stops, startedAt, updatedAt };
}

/** Разобрать план из строки БД (JSON). Битое значение — пустой план. */
export function parseRoutePlan(raw: unknown): RoutePlan {
  if (typeof raw !== "string" || !raw.trim()) return emptyRoutePlan();
  try {
    return normalizeRoutePlan(JSON.parse(raw));
  } catch {
    return emptyRoutePlan();
  }
}

/** Строка для хранения в БД. */
export function serializeRoutePlan(plan: RoutePlan): string {
  return JSON.stringify(plan);
}

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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
  });

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect & {
  status: LeadStatus;
  source: LeadSource;
  /** "1" — заявка в архиве, "0" — активная. */
  archived: string;
};

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

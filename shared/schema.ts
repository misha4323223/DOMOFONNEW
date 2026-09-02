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

export const insertLeadSchema = createInsertSchema(leads)
  .omit({
    id: true,
    createdAt: true,
  })
  .extend({
    comment: z.string().nullish(),
    // Статус заявки: новая / срочно / выполнена
    status: z.enum(LEAD_STATUSES).default("new"),
  });

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect & { status: LeadStatus };

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

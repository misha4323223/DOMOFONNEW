import { type User, type InsertUser, type Lead, type InsertLead } from "@shared/schema";
import { randomUUID } from "crypto";
import { createYdbLead, listYdbLeads, updateYdbLead, deleteYdbLead } from "./ydb";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createLead(lead: InsertLead): Promise<Lead>;
  listLeads(): Promise<Lead[]>;
  updateLead(id: string, patch: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users = new Map<string, User>();
  private leads = new Map<string, Lead>();
  private useYdb = Boolean(process.env.YDB_DATABASE_PATH);

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((user) => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const user: User = { ...insertUser, id: randomUUID() };
    this.users.set(user.id, user);
    return user;
  }

  async createLead(insertLead: InsertLead): Promise<Lead> {
    if (this.useYdb) return createYdbLead(insertLead);
    const lead: Lead = {
      ...insertLead,
      comment: insertLead.comment ?? null,
      status: insertLead.status ?? "new",
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.leads.set(lead.id, lead);
    return lead;
  }

  async listLeads(): Promise<Lead[]> {
    if (this.useYdb) return listYdbLeads();
    return Array.from(this.leads.values()).sort((a, b) =>
      (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
  }

  async updateLead(id: string, patch: Partial<InsertLead>): Promise<Lead | undefined> {
    if (this.useYdb) return updateYdbLead(id, patch);
    const current = this.leads.get(id);
    if (!current) return undefined;
    const updated: Lead = { ...current, ...patch, comment: patch.comment ?? current.comment };
    this.leads.set(id, updated);
    return updated;
  }

  async deleteLead(id: string): Promise<boolean> {
    if (this.useYdb) return deleteYdbLead(id);
    return this.leads.delete(id);
  }
}

export const storage = new MemStorage();
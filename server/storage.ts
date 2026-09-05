import { type User, type InsertUser, type Lead, type InsertLead } from "@shared/schema";
import { randomUUID } from "crypto";
import {
  createYdbLead,
  listYdbLeads,
  updateYdbLead,
  deleteYdbLead,
  getYdbSetting,
  putYdbSetting,
  deleteYdbSetting,
  createYdbNote,
  listYdbNotes,
  updateYdbNote,
  deleteYdbNote,
  sendYdbChatMessage,
  listYdbChatMessages,
  type StoredSetting,
  type Note,
  type NoteInput,
  type NotePatch,
  type ChatMessage,
  type ChatMessageInput,
} from "./ydb";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createLead(lead: InsertLead): Promise<Lead>;
  listLeads(): Promise<Lead[]>;
  updateLead(id: string, patch: Partial<InsertLead>): Promise<Lead | undefined>;
  deleteLead(id: string): Promise<boolean>;
  // Настройки сайта (контент главной страницы и фото) — key/value.
  getSetting(key: string): Promise<StoredSetting | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  removeSetting(key: string): Promise<void>;
  // Заметки и чат — только мобильное приложение.
  createNote(note: NoteInput): Promise<Note>;
  listNotes(): Promise<Note[]>;
  updateNote(id: string, patch: NotePatch): Promise<Note | undefined>;
  deleteNote(id: string): Promise<boolean>;
  sendChatMessage(message: ChatMessageInput): Promise<ChatMessage>;
  listChatMessages(after?: string): Promise<ChatMessage[]>;
}

export class MemStorage implements IStorage {
  private users = new Map<string, User>();
  private leads = new Map<string, Lead>();
  private settings = new Map<string, StoredSetting>();
  private notes = new Map<string, Note>();
  private chat = new Map<string, ChatMessage>();
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

  async getSetting(key: string): Promise<StoredSetting | undefined> {
    if (this.useYdb) return getYdbSetting(key);
    return this.settings.get(key);
  }

  async setSetting(key: string, value: string): Promise<void> {
    if (this.useYdb) {
      await putYdbSetting(key, value);
      return;
    }
    this.settings.set(key, { value, updatedAt: new Date().toISOString() });
  }

  async removeSetting(key: string): Promise<void> {
    if (this.useYdb) {
      await deleteYdbSetting(key);
      return;
    }
    this.settings.delete(key);
  }

  async createNote(input: NoteInput): Promise<Note> {
    if (this.useYdb) return createYdbNote(input);
    const now = new Date().toISOString();
    const note: Note = {
      id: randomUUID(),
      text: input.text,
      author: input.author,
      done: "0",
      createdAt: now,
      updatedAt: now,
    };
    this.notes.set(note.id, note);
    return note;
  }

  async listNotes(): Promise<Note[]> {
    if (this.useYdb) return listYdbNotes();
    return Array.from(this.notes.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async updateNote(id: string, patch: NotePatch): Promise<Note | undefined> {
    if (this.useYdb) return updateYdbNote(id, patch);
    const current = this.notes.get(id);
    if (!current) return undefined;
    const updated: Note = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.notes.set(id, updated);
    return updated;
  }

  async deleteNote(id: string): Promise<boolean> {
    if (this.useYdb) return deleteYdbNote(id);
    return this.notes.delete(id);
  }

  async sendChatMessage(input: ChatMessageInput): Promise<ChatMessage> {
    if (this.useYdb) return sendYdbChatMessage(input);
    const message: ChatMessage = {
      id: randomUUID(),
      sender: input.sender,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    this.chat.set(message.id, message);
    return message;
  }

  async listChatMessages(after?: string): Promise<ChatMessage[]> {
    if (this.useYdb) return listYdbChatMessages(after);
    return Array.from(this.chat.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .filter((m) => !after || m.createdAt > after);
  }
}

export const storage = new MemStorage();

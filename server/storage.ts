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
  unlinkYdbNotesByLead,
  sendYdbChatMessage,
  listYdbChatMessages,
  getYdbChatUnread,
  markYdbChatRead,
  updateYdbChatMessage,
  deleteYdbChatMessage,
  createYdbReview,
  listYdbReviews,
  listYdbPublishedReviews,
  updateYdbReview,
  deleteYdbReview,
  type StoredSetting,
  type Note,
  type NoteInput,
  type NotePatch,
  type ChatMessage,
  type ChatMessageInput,
  type ChatUnread,
  type Review,
  type ReviewInput,
  type ReviewStatus,
} from "./ydb";

/** Ключ настройки: createdAt последнего прочитанного сообщения чата. */
const CHAT_LAST_READ_KEY = "chat:last-read";

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
  /** Отвязать от заявки все её заметки (при удалении заявки). */
  unlinkNotesByLead(leadId: string): Promise<void>;
  sendChatMessage(message: ChatMessageInput): Promise<ChatMessage>;
  listChatMessages(after?: string): Promise<ChatMessage[]>;
  updateChatMessage(id: string, patch: { text?: string }): Promise<ChatMessage | undefined>;
  deleteChatMessage(id: string): Promise<boolean>;
  /** Сколько сообщений чата непрочитано (якорь прочтения — на сервере). */
  getChatUnread(): Promise<ChatUnread>;
  /** Пометить все сообщения чата прочитанными (счётчик обнуляется). */
  markChatRead(): Promise<ChatUnread>;
  // Отзывы клиентов (сайт + админка).
  createReview(review: ReviewInput): Promise<Review>;
  listReviews(): Promise<Review[]>;
  listPublishedReviews(): Promise<Review[]>;
  updateReview(
    id: string,
    patch: { status?: ReviewStatus; reply?: string },
  ): Promise<Review | undefined>;
  deleteReview(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users = new Map<string, User>();
  private leads = new Map<string, Lead>();
  private settings = new Map<string, StoredSetting>();
  private notes = new Map<string, Note>();
  private chat = new Map<string, ChatMessage>();
  private reviews = new Map<string, Review>();
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
      source: insertLead.source ?? "site",
      archived: insertLead.archived ?? "0",
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
      leadId: input.leadId ?? null,
    };
    this.notes.set(note.id, note);
    return note;
  }

  async unlinkNotesByLead(leadId: string): Promise<void> {
    if (this.useYdb) return unlinkYdbNotesByLead(leadId);
    for (const note of Array.from(this.notes.values())) {
      if (note.leadId === leadId) {
        note.leadId = null;
        note.updatedAt = new Date().toISOString();
      }
    }
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
      address: input.address ?? "",
      text: input.text,
      createdAt: new Date().toISOString(),
      ...(input.image ? { image: input.image } : {}),
    };
    this.chat.set(message.id, message);
    return message;
  }

  async getChatUnread(): Promise<ChatUnread> {
    if (this.useYdb) return getYdbChatUnread();
    const messages = await this.listChatMessages();
    const readAt = this.settings.get(CHAT_LAST_READ_KEY)?.value ?? null;
    const lastMessageAt =
      messages.length > 0 ? messages[messages.length - 1].createdAt : null;
    return {
      count: readAt ? messages.filter((m) => m.createdAt > readAt).length : 0,
      readAt,
      lastMessageAt,
    };
  }

  async markChatRead(): Promise<ChatUnread> {
    if (this.useYdb) return markYdbChatRead();
    const messages = await this.listChatMessages();
    const lastMessageAt =
      messages.length > 0 ? messages[messages.length - 1].createdAt : null;
    const readAt = lastMessageAt ?? new Date().toISOString();
    this.settings.set(CHAT_LAST_READ_KEY, {
      value: readAt,
      updatedAt: new Date().toISOString(),
    });
    return { count: 0, readAt, lastMessageAt };
  }

  async listChatMessages(after?: string): Promise<ChatMessage[]> {
    if (this.useYdb) return listYdbChatMessages(after);
    return Array.from(this.chat.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .filter((m) => !after || m.createdAt > after);
  }

  async updateChatMessage(id: string, patch: { text?: string }): Promise<ChatMessage | undefined> {
    if (this.useYdb) return updateYdbChatMessage(id, patch);
    const msg = this.chat.get(id);
    if (!msg) return undefined;
    const updated: ChatMessage = {
      ...msg,
      text: patch.text ?? msg.text,
      editedAt: new Date().toISOString(),
    };
    this.chat.set(id, updated);
    return updated;
  }

  async deleteChatMessage(id: string): Promise<boolean> {
    if (this.useYdb) return deleteYdbChatMessage(id);
    return this.chat.delete(id);
  }

  async createReview(input: ReviewInput): Promise<Review> {
    if (this.useYdb) return createYdbReview(input);
    const review: Review = {
      id: randomUUID(),
      name: input.name,
      city: input.city ?? "",
      rating: input.rating,
      text: input.text,
      status: "new",
      reply: "",
      createdAt: new Date().toISOString(),
    };
    this.reviews.set(review.id, review);
    return review;
  }

  async listReviews(): Promise<Review[]> {
    if (this.useYdb) return listYdbReviews();
    return Array.from(this.reviews.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async listPublishedReviews(): Promise<Review[]> {
    if (this.useYdb) return listYdbPublishedReviews();
    return (await this.listReviews()).filter((r) => r.status === "published");
  }

  async updateReview(
    id: string,
    patch: { status?: ReviewStatus; reply?: string },
  ): Promise<Review | undefined> {
    if (this.useYdb) return updateYdbReview(id, patch);
    const current = this.reviews.get(id);
    if (!current) return undefined;
    const updated: Review = {
      ...current,
      status: patch.status ?? current.status,
      reply: patch.reply ?? current.reply,
    };
    this.reviews.set(id, updated);
    return updated;
  }

  async deleteReview(id: string): Promise<boolean> {
    if (this.useYdb) return deleteYdbReview(id);
    return this.reviews.delete(id);
  }
}

export const storage = new MemStorage();

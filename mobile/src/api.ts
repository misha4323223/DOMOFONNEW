import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HomeContent } from "./content";

export const API_BASE = "https://obzor71.ru";

const CACHE_KEY = "leads_cache";

/** Сохранить заявки в локальный кеш */
export async function cacheLeads(leads: Lead[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(leads));
  } catch {
    // кеш не критичен — молча пропускаем
  }
}

/** Прочитать заявки из локального кеша (или []) */
export async function getCachedLeads(): Promise<Lead[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Lead[];
  } catch {
    return [];
  }
}

export type LeadStatus = "new" | "urgent" | "done";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  service: string;
  address: string;
  comment: string | null;
  status: LeadStatus;
  /** Откуда заявка: "site" — клиент с сайта, "admin" — добавлена вручную. */
  source?: "site" | "admin";
  createdAt: string;
}

export interface LeadInput {
  name: string;
  phone: string;
  service: string;
  address: string;
  comment: string | null;
}

export type LeadPatch = Partial<LeadInput> & { status?: LeadStatus };

export const LEAD_STATUSES: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Новая" },
  { value: "urgent", label: "Срочно" },
  { value: "done", label: "Выполнена" },
];

export function statusLabel(value: LeadStatus | undefined): string {
  return (
    LEAD_STATUSES.find((s) => s.value === (value ?? "new"))?.label ?? "Новая"
  );
}

export const SERVICES: { value: string; label: string }[] = [
  { value: "install", label: "Установка домофона" },
  { value: "repair", label: "Обслуживание / не работает" },
  { value: "maintenance", label: "Обслуживание" },
  { value: "consult", label: "Консультация" },
];

export function serviceLabel(value: string): string {
  return SERVICES.find((s) => s.value === value)?.label ?? value;
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<any> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    // X-Admin-Token, а не Authorization: Yandex API Gateway на домене
    // не пропускает заголовок Authorization и отвечает на него 403.
    headers["X-Admin-Token"] = options.token;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined;

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    // Кладём HTTP-статус в ошибку: по нему отличаем «сервер отверг» (4xx)
    // от «сервер временно лежит» (5xx) при работе офлайн-очереди.
    const err = new Error(
      data?.message || `Ошибка сервера (${res.status})`,
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Ошибка сети (нет интернета и т.п.) — запрос можно безопасно повторить позже.
 * В React Native fetch обычно падает с TypeError("Network request failed").
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (
    e instanceof Error &&
    /network request failed|network error|failed to fetch|load failed/i.test(
      e.message,
    )
  ) {
    return true;
  }
  return false;
}

/** Временная ошибка сервера (5xx) — стоит повторить запрос позже. */
export function isServerError(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
}

export const api = {
  login: (password: string) =>
    request("/api/admin/login", { method: "POST", body: { password } }),

  leads: (token: string) => request("/api/leads", { token }),

  createLead: (token: string, lead: LeadInput) =>
    request("/api/leads/admin", { method: "POST", body: lead, token }),

  updateLead: (token: string, id: string, patch: LeadPatch) =>
    request(`/api/leads/${id}`, { method: "PATCH", body: patch, token }),

  deleteLead: (token: string, id: string) =>
    request(`/api/leads/${id}`, { method: "DELETE", token }),

  registerPushToken: (token: string, pushToken: string) =>
    request("/api/admin/push-token", {
      method: "POST",
      body: { token: pushToken },
      token,
    }),

  scan: (token: string, imageBase64: string, mimeType: "JPEG" | "PNG") =>
    request("/api/admin/scan", {
      method: "POST",
      body: { image: imageBase64, mimeType },
      token,
    }),

  /** Текущий контент главной страницы (публичный эндпоинт). */
  getContent: () =>
    request("/api/content") as Promise<{
      content: HomeContent;
      updatedAt: string | null;
    }>,

  /** Сохранить контент главной страницы из редактора. */
  saveContent: (token: string, content: HomeContent) =>
    request("/api/admin/content", {
      method: "PUT",
      body: { content },
      token,
    }) as Promise<{ ok: boolean; content: HomeContent; updatedAt: string }>,

  /** Загрузить своё фото первого экрана (data-url, сжатый jpeg/webp/png). */
  uploadContentImage: (token: string, key: string, dataUrl: string) =>
    request("/api/admin/content/image", {
      method: "PUT",
      body: { key, dataUrl },
      token,
    }) as Promise<{ ok: boolean; url: string }>,

  /** Удалить загруженное фото (вернуть стандартное из сборки). */
  deleteContentImage: (token: string, key: string) =>
    request(`/api/admin/content/image/${key}`, {
      method: "DELETE",
      token,
    }) as Promise<{ ok: boolean }>,

  // --- Заметки (общие для всех админов) ---

  notes: (token: string) => request("/api/notes", { token }) as Promise<Note[]>,

  createNote: (token: string, text: string, author: string) =>
    request("/api/notes", {
      method: "POST",
      body: { text, author },
      token,
    }) as Promise<Note>,

  updateNote: (token: string, id: string, patch: NotePatch) =>
    request(`/api/notes/${id}`, { method: "PATCH", body: patch, token }) as Promise<Note>,

  deleteNote: (token: string, id: string) =>
    request(`/api/notes/${id}`, { method: "DELETE", token }),

  // --- Отзывы клиентов (модерация) ---

  /** Все отзывы (включая ожидающие модерации) — только для админа. */
  reviews: (token: string) =>
    request("/api/admin/reviews", { token }) as Promise<Review[]>,

  /** Сменить статус отзыва: "new" → "published" / "hidden". */
  updateReview: (token: string, id: string, status: ReviewStatus) =>
    request(`/api/admin/reviews/${id}`, {
      method: "PATCH",
      body: { status },
      token,
    }) as Promise<Review>,

  deleteReview: (token: string, id: string) =>
    request(`/api/admin/reviews/${id}`, { method: "DELETE", token }) as Promise<{
      ok: boolean;
    }>,

  // --- Чат между админами ---

  chatMessages: (token: string, after?: string) =>
    request(
      `/api/chat/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      { token },
    ) as Promise<ChatMessage[]>,  sendChatMessage: (token: string, text: string, sender: string) =>
    request("/api/chat/messages", {
      method: "POST",
      body: { text, sender },
      token,
    }) as Promise<ChatMessage>,

  updateChatMessage: (token: string, id: string, text: string) =>
    request(`/api/chat/messages/${id}`, {
      method: "PATCH",
      body: { text },
      token,
    }) as Promise<ChatMessage>,

  deleteChatMessage: (token: string, id: string) =>
    request(`/api/chat/messages/${id}`, {
      method: "DELETE",
      token,
    }) as Promise<{ ok: boolean }>,
  };

// --- Отзывы клиентов (модерация) ---

export type ReviewStatus = "new" | "published" | "hidden";

export interface Review {
  id: string;
  /** Имя автора (как он представился). */
  name: string;
  /** Город — необязательное поле. */
  city: string;
  /** Оценка от 1 до 5 (строкой, как в YDB). */
  rating: string;
  /** Текст отзыва. */
  text: string;
  status: ReviewStatus;
  createdAt: string;
}

export const REVIEW_STATUSES: { value: ReviewStatus; label: string }[] = [
  { value: "new", label: "На модерации" },
  { value: "published", label: "Опубликован" },
  { value: "hidden", label: "Скрыт" },
];

export function reviewStatusLabel(value: ReviewStatus | undefined): string {
  return (
    REVIEW_STATUSES.find((s) => s.value === (value ?? "new"))?.label ??
    "На модерации"
  );
}

export interface Note {
  id: string;
  text: string;
  author: string;
  /** "0" — не выполнено, "1" — выполнено. */
  done: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  text: string;
  author: string;
}

export type NotePatch = Partial<NoteInput> & { done?: string };

const NOTES_CACHE_KEY = "notes_cache";

/** Сохранить заметки в локальный кеш */
export async function cacheNotes(notes: Note[]): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(notes));
  } catch {
    // кеш не критичен — молча пропускаем
  }
}

/** Прочитать заметки из локального кеша (или []) */
export async function getCachedNotes(): Promise<Note[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Note[];
  } catch {
    return [];
  }
}

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  createdAt: string;
  editedAt?: string;
}

export interface LeadCandidate {
  name: string;
  phone: string;
  address: string;
  service: string | null;
  comment: string;
  raw: string;
}

export interface ScanResult {
  fullText: string;
  lines: string[];
  candidates: LeadCandidate[];
}

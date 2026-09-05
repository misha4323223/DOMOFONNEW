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
  { value: "repair", label: "Ремонт / не работает" },
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
    throw new Error(data?.message || `Ошибка сервера (${res.status})`);
  }
  return data;
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
};

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

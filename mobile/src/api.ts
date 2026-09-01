export const API_BASE = "https://www.obzor71.ru";

export interface Lead {
  id: string;
  name: string;
  phone: string;
  service: string;
  address: string;
  comment: string | null;
  createdAt: string;
}

export type LeadInput = Omit<Lead, "id" | "createdAt">;

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
    headers["Authorization"] = `Bearer ${options.token}`;
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

  updateLead: (token: string, id: string, patch: Partial<LeadInput>) =>
    request(`/api/leads/${id}`, { method: "PATCH", body: patch, token }),

  deleteLead: (token: string, id: string) =>
    request(`/api/leads/${id}`, { method: "DELETE", token }),

  registerPushToken: (token: string, pushToken: string) =>
    request("/api/admin/push-token", {
      method: "POST",
      body: { token: pushToken },
      token,
    }),
};

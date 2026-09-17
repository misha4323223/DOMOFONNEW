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

/** Найденная ошибка в тексте: где, что и чем предлагается заменить. */
export interface SpellIssue {
  /** Смещение фрагмента в тексте (в символах). */
  offset: number;
  /** Длина фрагмента. */
  length: number;
  /** Сам фрагмент с ошибкой. */
  word: string;
  /** Пояснение сервиса. */
  message: string;
  /** Варианты замены, самый вероятный — первым. */
  suggestions: string[];
}

/**
 * Расходник, израсходованный на заявке.
 *
 * Название и единица — снимок на момент прикрепления: позицию могут потом
 * переименовать или удалить, а в заявке всё останется читаемым.
 */
export interface LeadPart {
  /** id позиции в расходниках. */
  stockId: string;
  name: string;
  unit: string;
  /** Сколько израсходовано на этой заявке. */
  qty: number;
}

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
  /** "1" — заявка в архиве (выполнена и убрана админом), "0" — активная. */
  archived?: string;
  /** Расходники, израсходованные на заявке. */
  parts?: LeadPart[];
  /** "1" — расходники уже списаны с остатка. Считает сервер. */
  partsDone?: string;
  createdAt: string;
}

export interface LeadInput {
  name: string;
  phone: string;
  service: string;
  address: string;
  comment: string | null;
  /**
   * Расходники, израсходованные на заявке. Их можно прикрепить сразу при
   * создании заявки: с остатка они спишутся тогда, когда заявку переведут
   * в «Выполнена» (делает сервер).
   */
  parts?: LeadPart[];
}

export type LeadPatch = Partial<LeadInput> & {
  status?: LeadStatus;
  /** "1" — в архив, "0" — вернуть из архива. */
  archived?: string;
  /** Расходники заявки. Списываются, когда заявка становится выполненной. */
  parts?: LeadPart[];
};

/**
 * Краткое описание расходников для карточки: «Панель ×1, Трубка ×2».
 * Показываем не больше `limit` позиций, остальное — «и ещё N».
 */
export function partsSummary(parts: LeadPart[] | undefined, limit = 2): string {
  const list = parts ?? [];
  if (list.length === 0) return "";
  const shown = list
    .slice(0, limit)
    .map((p) => `${p.name} ×${formatQty(p.qty)}`)
    .join(", ");
  const rest = list.length - limit;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/** Всего единиц расхода по заявке (для суммы «5 шт»). */
export function partsTotal(parts: LeadPart[] | undefined): number {
  return (parts ?? []).reduce((sum, p) => sum + p.qty, 0);
}

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
  { value: "cctv", label: "Видеонаблюдение" },
  { value: "repair", label: "Обслуживание / не работает" },
  { value: "maintenance", label: "Обслуживание" },
  { value: "consult", label: "Консультация" },
];

export function serviceLabel(value: string): string {
  return SERVICES.find((s) => s.value === value)?.label ?? value;
}

/**
 * Сколько ждём ответа сервера.
 *
 * Без таймаута запрос в сети без интернета (Wi-Fi подключён, а связи нет)
 * висит минутами: кнопка «Сохранить» крутится, техник у подъезда решает,
 * что приложение сломалось, и заявка теряется.
 */
const REQUEST_TIMEOUT_MS = 15_000;

async function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<any> {
  const headers: Record<string, string> = {};
  // Никогда не кэшировать ответы API: иначе HTTP-кеш может прислать
  // 304 Not Modified без тела, а это здесь считается ошибкой.
  headers["Cache-Control"] = "no-store";
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    // X-Admin-Token, а не Authorization: Yandex API Gateway на домене
    // не пропускает заголовок Authorization и отвечает на него 403.
    headers["X-Admin-Token"] = options.token;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    // Оборванный по таймауту запрос приводим к обычной «сетевой» ошибке:
    // тогда экран кладёт изменение в офлайн-очередь, а не показывает сбой.
    if (timedOut) throw new TypeError("Сервер не ответил: нет связи");
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined;
  // 304 Not Modified не должен ронять экраны: без тела возвращать нечего,
  // пусть вызывающий код использует то, что уже есть.
  if (res.status === 304) return undefined;

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
 * Ошибка «до сервера не достучались»: нет интернета, таймаут, обрыв связи.
 *
 * Признак простой: ответа от сервера мы вообще не получили, то есть у ошибки
 * нет HTTP-статуса (его ставит request() ниже, когда сервер ответил 4xx/5xx).
 * В React Native fetch обычно падает с TypeError("Network request failed").
 *
 * Раньше проверялся только TypeError — и запрос, повисший в сети без
 * интернета, в эту ветку не попадал: форма показывала «Не удалось сохранить»,
 * а заявка, занесённая техником у подъезда, терялась. Теперь любое изменение,
 * которое не доехало до сервера, кладётся в офлайн-очередь и уйдёт само.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (
    e instanceof Error &&
    /network request failed|network error|failed to fetch|load failed|abort|timeout|timed out/i.test(
      e.message,
    )
  ) {
    return true;
  }
  // Ответа от сервера нет вовсе (ни 4xx, ни 5xx) — считаем потерей связи.
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status !== "number";
}

/** Временная ошибка сервера (5xx) — стоит повторить запрос позже. */
export function isServerError(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 500;
}

// --- Координаты для карты маршрута ---
// Считает наш сервер через OpenStreetMap: ключей и счетов не нужно.

/** Насколько точно найдена точка: дом / только улица / непонятно. */
export type GeoPrecision = "house" | "street" | "unknown";

export interface GeoStopResult {
  id: string;
  ok: boolean;
  lat: number | null;
  lon: number | null;
  /** Что нашлось: «5, улица Ленина, Щёкино…» — показываем админу. */
  label: string;
  precision: GeoPrecision;
}

/** Линия маршрута: расстояние, время и точки [широта, долгота]. */
export interface GeoRoute {
  /** Длина в метрах. */
  distance: number;
  /** Время в пути в секундах. */
  duration: number;
  geometry: [number, number][];
}

/** Дорожный маршрут от машины до точек — то, что видит водитель в поездке. */
export interface GeoRideLeg {
  /** К какой точке ведёт этот участок. */
  id: string;
  distance: number;
  duration: number;
}

export interface GeoRideRoute {
  /** Километры и время от машины через все оставшиеся точки. */
  distance: number;
  duration: number;
  geometry: [number, number][];
  /** По каждому участку: «до точки 3,4 км, 12 мин». */
  legs: GeoRideLeg[];
}

export interface GeoPlanResult {
  stops: GeoStopResult[];
  route: GeoRoute | null;
  /** Сколько адресов ещё не разобрано — тогда запрос надо повторить. */
  remaining: number;
  /**
   * Сервис карт не ответил хотя бы по одному адресу. Это не «адрес не найден»:
   * показываем отдельную подсказку и предлагаем повторить.
   */
  unavailable?: boolean;
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

  /** Разобрать надиктованную фразу в поля заявки (распознаёт её устройство). */
  parseDictation: (token: string, text: string) =>
    request("/api/admin/parse", {
      method: "POST",
      body: { text },
      token,
    }) as Promise<{ text: string; fields: DictatedLead }>,

  /** Текущий контент главной страницы (публичный эндпоинт). */
  getContent: () =>
    request("/api/content") as Promise<{
      content: HomeContent;
      updatedAt: string | null;
    }>,

  /**
   * Проверка орфографии (тексты сайта и ответы на отзывы).
   *
   * Вызывается только по кнопке: текст уходит на внешний сервис, поэтому в
   * заявках и заметках, где бывают адреса и телефоны клиентов, её нет.
   */
  checkSpelling: (token: string, text: string) =>
    request("/api/admin/spellcheck", {
      method: "POST",
      body: { text },
      token,
    }) as Promise<{ issues: SpellIssue[] }>,

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

  createNote: (token: string, text: string, author: string, leadId?: string | null) =>
    request("/api/notes", {
      method: "POST",
      body:
        leadId !== undefined
          ? { text, author, leadId }
          : { text, author },
      token,
    }) as Promise<Note>,

  updateNote: (token: string, id: string, patch: NotePatch) =>
    request(`/api/notes/${id}`, { method: "PATCH", body: patch, token }) as Promise<Note>,

  deleteNote: (token: string, id: string) =>
    request(`/api/notes/${id}`, { method: "DELETE", token }),

  // --- Расходники в машине мастера ---

  stock: (token: string) =>
    request("/api/stock", { token }) as Promise<StockItem[]>,

  createStockItem: (token: string, item: StockItemInput) =>
    request("/api/stock", { method: "POST", body: item, token }) as Promise<StockItem>,

  updateStockItem: (token: string, id: string, patch: StockItemPatch) =>
    request(`/api/stock/${id}`, {
      method: "PATCH",
      body: patch,
      token,
    }) as Promise<StockItem>,

  /** Списать (delta < 0) или добавить (delta > 0) к остатку. */
  adjustStockItem: (token: string, id: string, delta: number) =>
    request(`/api/stock/${id}/adjust`, {
      method: "POST",
      body: { delta },
      token,
    }) as Promise<StockItem>,

  deleteStockItem: (token: string, id: string) =>
    request(`/api/stock/${id}`, { method: "DELETE", token }),

  // --- Маршрут на день ---

  /** План объезда с сервера (пустой план — маршрут ещё не собирали). */
  route: (token: string) =>
    request("/api/admin/route", { token }) as Promise<RoutePlan>,

  /** Сохранить план объезда на сервере. */
  saveRoute: (token: string, plan: RoutePlan) =>
    request("/api/admin/route", {
      method: "PUT",
      body: plan,
      token,
    }) as Promise<RoutePlan>,

  /**
   * Координаты точек маршрута и линия проезда — для карты в приложении.
   *
   * Адреса ищутся по правилам OpenStreetMap (не чаще одного раза в секунду),
   * поэтому за один вызов сервер разбирает не все новые адреса сразу: если в
   * ответе remaining > 0, запрос нужно повторить. Уже найденное сервер отдаёт
   * из кэша мгновенно, поэтому точки появляются на карте постепенно.
   */
  /**
   * Дорожный маршрут от текущего положения машины до оставшихся точек.
   * Считается по движению, а не постоянно: сервер кэширует ответ по сетке
   * ~100 метров, чтобы не мучить бесплатный маршрутизатор OSM.
   */
  rideRoute: (
    token: string,
    from: { lat: number; lon: number },
    points: { id: string; lat: number; lon: number }[],
  ) =>
    request("/api/admin/geo/route", {
      method: "POST",
      body: { from, points },
      token,
    }) as Promise<GeoRideRoute>,

  /**
   * Координаты точек маршрута. refresh = true — ручное «Повторить»: сервер
   * заново проверит адреса, которые в прошлый раз не нашлись.
   */
  geoPlan: (
    token: string,
    stops: { id: string; address: string; city?: string }[],
    refresh = false,
  ) =>
    request("/api/admin/geo/plan", {
      method: "POST",
      body: { stops, refresh },
      token,
    }) as Promise<GeoPlanResult>,

  // --- Отзывы клиентов (модерация) ---

  /** Все отзывы (включая ожидающие модерации) — только для админа. */
  reviews: (token: string) =>
    request("/api/admin/reviews", { token }) as Promise<Review[]>,

  /** Сменить статус отзыва и/или сохранить ответ службы (reply: "" — убрать). */
  updateReview: (
    token: string,
    id: string,
    patch: { status?: ReviewStatus; reply?: string },
  ) =>
    request(`/api/admin/reviews/${id}`, {
      method: "PATCH",
      body: patch,
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
    ) as Promise<ChatMessage[]>,

  /**
   * Сколько сообщений чата ещё не прочитано. Считает сервер по своему якорю
   * прочтения — счётчик не зависит от часов телефона.
   */
  chatUnread: (token: string) =>
    request("/api/chat/unread", { token }) as Promise<ChatUnread>,

  /** Явно пометить все сообщения чата прочитанными (счётчик обнуляется). */
  markChatRead: (token: string) =>
    request("/api/chat/read", { method: "POST", token }) as Promise<ChatUnread>,
  sendChatMessage: (token: string, text: string, sender: string, image?: string) =>
    request("/api/chat/messages", {
      method: "POST",
      body: image ? { text, sender, image } : { text, sender },
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
  /** Ответ службы на отзыв; пусто — ответа нет. */
  reply: string;
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
  /** id заявки, к которой привязана заметка; null — общая заметка. */
  leadId: string | null;
}

export interface NoteInput {
  text: string;
  author: string;
  leadId?: string | null;
}

export type NotePatch = Partial<NoteInput> & { done?: string };

// --- Расходники в машине мастера ---

export interface StockItem {
  id: string;
  /** Название позиции («Панель вызывная ELTIS»). */
  name: string;
  /** Единица измерения: «шт», «м», «пара». */
  unit: string;
  /** Сколько сейчас в машине. */
  qty: number;
  /** Остаток, ниже которого показываем «пора закупать» (0 — без порога). */
  minQty: number;
  /** Необязательная заметка. */
  note: string;
  updatedAt: string;
}

export interface StockItemInput {
  name: string;
  unit?: string;
  qty?: number;
  minQty?: number;
  note?: string;
}

export type StockItemPatch = Partial<StockItemInput>;

// --- Маршрут на день ---

/**
 * План объезда заявок.
 *
 * Порядок собирает само приложение (сначала город, внутри города — улица и
 * дом), сервер только хранит план — см. server/routes.ts.
 * «Сделано» отдельно не отмечается: это статус самой заявки, поэтому отметка
 * не может разъехаться с реальностью.
 */
export interface RoutePlan {
  /** id заявок в порядке объезда. */
  stops: string[];
  /** Когда маршрут запущен (ISO); null — план ещё собирается. */
  startedAt: string | null;
  /** Когда план последний раз менялся (ISO). По нему выбираем свежую версию. */
  updatedAt: string;
}

/** Больше этого числа точек в один маршрут не берём. */
export const ROUTE_MAX_STOPS = 50;

/** Пустой план: маршрут ещё не собирали. */
export function emptyRoutePlan(): RoutePlan {
  return { stops: [], startedAt: null, updatedAt: "" };
}

/**
 * Привести к плану что угодно (ответ сервера, кеш в телефоне).
 * Копия серверной normalizeRoutePlan: мобильное приложение не может
 * импортировать shared/ (Metro не видит файлы за пределами mobile/).
 */
export function normalizeRoutePlan(value: unknown): RoutePlan {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const stops: string[] = [];
  if (Array.isArray(raw.stops)) {
    for (const item of raw.stops) {
      const id = typeof item === "string" ? item.trim() : "";
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

/** Пора закупать: остаток дошёл до минимума или ниже. */
export function isLowStock(item: StockItem): boolean {
  return item.minQty > 0 && item.qty <= item.minQty;
}

/** Закончилось совсем — показываем красным. */
export function isOutOfStock(item: StockItem): boolean {
  return item.qty <= 0;
}

/** Число остатка без лишних нулей и с запятой: 3 → «3», 1.5 → «1,5». */
export function formatQty(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(".", ",");
}

const STOCK_CACHE_KEY = "stock_cache";

/** Сохранить расходники в локальный кеш (нужен для работы без сети). */
export async function cacheStock(items: StockItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(items));
  } catch {
    // кеш не критичен — молча пропускаем
  }
}

/** Прочитать расходники из локального кеша (или []) */
export async function getCachedStock(): Promise<StockItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STOCK_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StockItem[];
  } catch {
    return [];
  }
}

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
  /** Фото в сообщении (data-url jpeg/png/webp). */
  image?: string;
}

/** Состояние непрочитанных сообщений чата (считает сервер). */
export interface ChatUnread {
  /** Сколько сообщений новее якоря прочтения. */
  count: number;
  /** createdAt последнего прочитанного сообщения (null — чат ещё не читали). */
  readAt: string | null;
  /** createdAt последнего сообщения в чате (null — сообщений нет). */
  lastMessageAt: string | null;
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

/** Поля заявки, найденные в надиктованной фразе. */
export interface DictatedLead {
  name: string;
  phone: string;
  address: string;
  service: string | null;
  comment: string;
}

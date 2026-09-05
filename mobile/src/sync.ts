/**
 * Офлайн-очередь изменений.
 *
 * Когда нет интернета, приложение продолжает работать: изменения заявок и
 * контента сайта применяются локально (оптимистично) и складываются в очередь
 * в AsyncStorage. Как только связь появляется, очередь отправляется на сервер
 * в том же порядке, в котором изменения были сделаны.
 *
 * Что умеет очередь:
 *  - lead:create / lead:update / lead:delete — заявки;
 *  - content:save — контент главной страницы (полный документ);
 *  - content:image:upload / content:image:delete — фото первого экрана.
 *
 * Ошибки при отправке:
 *  - сетевые (нет интернета) и 5xx — операция остаётся в очереди, повторяем позже;
 *  - 4xx (сервер отверг данные, токен протух) — операция отбрасывается,
 *    чтобы очередь не застревала навсегда.
 */
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  api,
  cacheLeads,
  cacheNotes,
  getCachedLeads,
  getCachedNotes,
  isNetworkError,
  isServerError,
  type Lead,
  type LeadInput,
  type LeadPatch,
  type Note,
  type NoteInput,
  type NotePatch,
} from "./api";
import type { HomeContent } from "./content";

const QUEUE_KEY = "offline_queue";
const CONTENT_CACHE_KEY = "content_cache";

// --- Типы операций очереди ---

export type OfflineOp =
  | { id: string; kind: "lead:update"; leadId: string; patch: LeadPatch; createdAt: number }
  | { id: string; kind: "lead:create"; clientId: string; lead: LeadInput; createdAt: number }
  | { id: string; kind: "lead:delete"; leadId: string; createdAt: number }
  | { id: string; kind: "content:save"; content: HomeContent; createdAt: number }
  | { id: string; kind: "content:image:upload"; key: string; dataUrl: string; createdAt: number }
  | { id: string; kind: "content:image:delete"; key: string; createdAt: number }
  | { id: string; kind: "note:create"; clientId: string; note: NoteInput; createdAt: number }
  | { id: string; kind: "note:update"; noteId: string; patch: NotePatch; createdAt: number }
  | { id: string; kind: "note:delete"; noteId: string; createdAt: number }
  | { id: string; kind: "chat:send"; clientId: string; text: string; sender: string; address: string; createdAt: number };

/** Операция без служебных полей — то, что кладут экраны в очередь. */
export type OfflineOpInput =
  | { kind: "lead:update"; leadId: string; patch: LeadPatch }
  | { kind: "lead:create"; clientId: string; lead: LeadInput }
  | { kind: "lead:delete"; leadId: string }
  | { kind: "content:save"; content: HomeContent }
  | { kind: "content:image:upload"; key: string; dataUrl: string }
  | { kind: "content:image:delete"; key: string }
  | { kind: "note:create"; clientId: string; note: NoteInput }
  | { kind: "note:update"; noteId: string; patch: NotePatch }
  | { kind: "note:delete"; noteId: string }
  | { kind: "chat:send"; clientId: string; text: string; sender: string; address: string };

export interface SyncState {
  /** Есть ли связь с сервером (по последнему запросу). */
  online: boolean;
  /** Сколько изменений ждут отправки. */
  pending: number;
  /** Счётчик успешных отправок очереди — по нему экраны перечитывают данные. */
  revision: number;
}

let syncState: SyncState = { online: true, pending: 0, revision: 0 };
const listeners = new Set<(s: SyncState) => void>();

function setSyncState(patch: Partial<SyncState>) {
  syncState = { ...syncState, ...patch };
  for (const l of listeners) l(syncState);
}

export function getSyncState(): SyncState {
  return syncState;
}

/** Подписка на изменения состояния синхронизации. Возвращает отписку. */
export function subscribeSync(cb: (s: SyncState) => void): () => void {
  listeners.add(cb);
  cb(syncState);
  return () => {
    listeners.delete(cb);
  };
}

/** Хук: текущее состояние очереди (offline / pending). */
export function useSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(syncState);
  useEffect(() => subscribeSync(setState), []);
  return state;
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- Персистентность очереди ---

async function readQueue(): Promise<OfflineOp[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineOp[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(ops: OfflineOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
  } catch {
    // Хранилище недоступно — изменения не сохранятся, но приложение не падает
  }
}

/** Положить операцию в очередь и сообщить подписчикам. */
export async function enqueue(op: OfflineOpInput): Promise<void> {
  const ops = await readQueue();
  ops.push({ ...op, id: genId(), createdAt: Date.now() } as OfflineOp);
  await writeQueue(ops);
  setSyncState({ online: false, pending: ops.length });
}

// --- Локальный кеш заявок (тот же ключ, что в api.ts) ---

async function applyLeadPatchToCache(leadId: string, patch: LeadPatch): Promise<void> {
  const leads = await getCachedLeads();
  if (!leads.some((l) => l.id === leadId)) return;
  await cacheLeads(leads.map((l) => (l.id === leadId ? { ...l, ...patch } : l)));
}

async function applyLeadCreateToCache(lead: Lead): Promise<void> {
  const leads = await getCachedLeads();
  await cacheLeads([...leads, lead]);
}

async function applyLeadDeleteToCache(leadId: string): Promise<void> {
  const leads = await getCachedLeads();
  await cacheLeads(leads.filter((l) => l.id !== leadId));
}

/** После отправки созданной офлайн заявки — заменить локальный id на настоящий. */
async function replaceLocalLead(clientId: string, real: Lead): Promise<void> {
  const leads = await getCachedLeads();
  await cacheLeads(leads.map((l) => (l.id === clientId ? { ...real } : l)));
}

// --- Публичные помощники для экранов ---

/** Изменить заявку офлайн (patch применяется и в локальном кеше). */
export async function queueLeadUpdate(leadId: string, patch: LeadPatch): Promise<void> {
  await applyLeadPatchToCache(leadId, patch);
  await enqueue({ kind: "lead:update", leadId, patch });
}

/** Создать заявку офлайн (full — заявка с локальным id, status и createdAt). */
export async function queueLeadCreate(
  clientId: string,
  lead: LeadInput,
  full: Lead,
): Promise<void> {
  await applyLeadCreateToCache(full);
  await enqueue({ kind: "lead:create", clientId, lead });
}

/** Удалить заявку офлайн. */
export async function queueLeadDelete(leadId: string): Promise<void> {
  await applyLeadDeleteToCache(leadId);
  await enqueue({ kind: "lead:delete", leadId });
}

/** Сохранить контент главной страницы офлайн (полный документ). */
export async function queueContentSave(content: HomeContent): Promise<void> {
  await cacheContent(content);
  await enqueue({ kind: "content:save", content });
}

/** Загрузить фото первого экрана офлайн (применится при появлении связи). */
export async function queueContentImageUpload(key: string, dataUrl: string): Promise<void> {
  await enqueue({ kind: "content:image:upload", key, dataUrl });
}

/** Удалить загруженное фото офлайн. */
export async function queueContentImageDelete(key: string): Promise<void> {
  await enqueue({ kind: "content:image:delete", key });
}

// --- Заметки офлайн ---

async function applyNotePatchToCache(noteId: string, patch: NotePatch): Promise<void> {
  const notes = await getCachedNotes();
  if (!notes.some((n) => n.id === noteId)) return;
  await cacheNotes(notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)));
}

async function applyNoteCreateToCache(note: Note): Promise<void> {
  const notes = await getCachedNotes();
  await cacheNotes([...notes, note]);
}

async function applyNoteDeleteToCache(noteId: string): Promise<void> {
  const notes = await getCachedNotes();
  await cacheNotes(notes.filter((n) => n.id !== noteId));
}

/** После отправки созданной офлайн заметки — заменить локальный id на настоящий. */
async function replaceLocalNote(clientId: string, real: Note): Promise<void> {
  const notes = await getCachedNotes();
  await cacheNotes(notes.map((n) => (n.id === clientId ? { ...real } : n)));
}

/** Создать заметку офлайн (full — заметка с локальным id, done и датами). */
export async function queueNoteCreate(
  clientId: string,
  note: NoteInput,
  full: Note,
): Promise<void> {
  await applyNoteCreateToCache(full);
  await enqueue({ kind: "note:create", clientId, note });
}

/** Изменить заметку офлайн (text/done применяются и в локальном кеше). */
export async function queueNoteUpdate(noteId: string, patch: NotePatch): Promise<void> {
  await applyNotePatchToCache(noteId, patch);
  await enqueue({ kind: "note:update", noteId, patch });
}

/** Удалить заметку офлайн. */
export async function queueNoteDelete(noteId: string): Promise<void> {
  await applyNoteDeleteToCache(noteId);
  await enqueue({ kind: "note:delete", noteId });
}

/** Отправить сообщение в чат офлайн (применится при появлении связи). */
export async function queueChatSend(
  clientId: string,
  text: string,
  sender: string,
  address: string,
): Promise<void> {
  await enqueue({ kind: "chat:send", clientId, text, sender, address });
}

/** clientId сообщений чата, которые ещё ждут отправки (для пометки «⏳»). */
export async function pendingChatClientIds(): Promise<string[]> {
  const ops = await readQueue();
  return ops.filter((op) => op.kind === "chat:send").map((op) => op.clientId);
}

// --- Кеш контента главной страницы (чтобы офлайн открывался последний сохранённый) ---

export async function cacheContent(content: HomeContent): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(content));
  } catch {
    // не критично
  }
}

export async function getCachedContent(): Promise<HomeContent | null> {
  try {
    const raw = await AsyncStorage.getItem(CONTENT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as HomeContent) : null;
  } catch {
    return null;
  }
}

// --- Отправка очереди ---

async function executeOp(
  op: OfflineOp,
  token: string,
): Promise<{ created?: Lead; createdNote?: Note }> {
  switch (op.kind) {
    case "lead:update":
      await api.updateLead(token, op.leadId, op.patch);
      return {};
    case "lead:create": {
      const created = await api.createLead(token, op.lead);
      return { created };
    }
    case "lead:delete":
      await api.deleteLead(token, op.leadId);
      return {};
    case "content:save":
      await api.saveContent(token, op.content);
      return {};
    case "content:image:upload":
      await api.uploadContentImage(token, op.key, op.dataUrl);
      return {};
    case "content:image:delete":
      await api.deleteContentImage(token, op.key);
      return {};
    case "note:create": {
      const created = await api.createNote(token, op.note.text, op.note.author);
      return { createdNote: created };
    }
    case "note:update":
      await api.updateNote(token, op.noteId, op.patch);
      return {};
    case "note:delete":
      await api.deleteNote(token, op.noteId);
      return {};
    case "chat:send":
      await api.sendChatMessage(token, op.text, op.sender, op.address);
      return {};
  }
}

export interface FlushResult {
  /** Сколько операций успешно отправлено. */
  sent: number;
}

/**
 * Пытается отправить накопленные изменения на сервер в порядке очереди.
 * Сетевые ошибки и 5xx прерывают отправку (остальное ждёт следующей попытки),
 * 4xx — операция отбрасывается, чтобы очередь не застревала.
 */
export async function flushPending(
  token: string | null | undefined,
): Promise<FlushResult> {
  if (!token) return { sent: 0 };
  let ops = await readQueue();
  if (ops.length === 0) {
    setSyncState({ online: true });
    return { sent: 0 };
  }

  // Удаляем операции старше 10 минут — они застряли из-за постоянных ошибок сервера.
  const MAX_OP_AGE_MS = 10 * 60 * 1000;
  const now = Date.now();
  const staleOps = ops.filter((op) => now - op.createdAt > MAX_OP_AGE_MS);
  if (staleOps.length > 0) {
    ops = ops.filter((op) => now - op.createdAt <= MAX_OP_AGE_MS);
    await writeQueue(ops);
  }

  let sent = 0;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      const res = await executeOp(op, token);
      sent++;
      // Заявка, созданная офлайн, получила настоящий id — обновляем кеш
      // и переписываем ссылки на локальный id в оставшихся операх
      // (например, смена статуса только что созданной заявки).
      if (op.kind === "lead:create" && res.created) {
        await replaceLocalLead(op.clientId, res.created);
        for (let j = i + 1; j < ops.length; j++) {
          const next = ops[j];
          if (
            (next.kind === "lead:update" || next.kind === "lead:delete") &&
            next.leadId === op.clientId
          ) {
            next.leadId = res.created.id;
          }
        }
      }
      if (op.kind === "note:create" && res.createdNote) {
        await replaceLocalNote(op.clientId, res.createdNote);
        for (let j = i + 1; j < ops.length; j++) {
          const next = ops[j];
          if (
            (next.kind === "note:update" || next.kind === "note:delete") &&
            next.noteId === op.clientId
          ) {
            next.noteId = res.createdNote.id;
          }
        }
      }
    } catch (e) {
      if (isNetworkError(e) || isServerError(e)) {
        // Связи нет (или сервер временно лежит) — останавливаемся,
        // неотправленные операции ждут следующей попытки.
        ops.splice(0, i);
        await writeQueue(ops);
        setSyncState({ online: false, pending: ops.length });
        return { sent };
      }
      // 4xx или иная ошибка — сервер отверг операцию: отбрасываем её
      // и продолжаем со следующими.
    }
  }

  await writeQueue([]);
  setSyncState({
    online: true,
    pending: 0,
    revision: syncState.revision + (sent > 0 ? 1 : 0),
  });
  return { sent };
}
import { randomUUID } from "crypto";
import type { InsertLead, Lead } from "@shared/schema";

const DATABASE_PATH =
  process.env.YDB_DATABASE_PATH ??
  "/ru-central1/b1gpj9488h3k7oaa3foh/etn1ah45qvisdme7mftg";
const DOCUMENT_API_ENDPOINT =
  process.env.YDB_DOCUMENT_API_ENDPOINT ??
  `https://docapi.serverless.yandexcloud.net${DATABASE_PATH}`;
const TABLE_NAME = "leads";

let tableReady: Promise<void> | undefined;

export async function getIamToken(): Promise<string> {
  const explicit = process.env.YC_IAM_TOKEN;
  if (explicit) return explicit;

  const response = await fetch(
    "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) {
    throw new Error(`Yandex metadata token request failed: ${response.status}`);
  }
  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Yandex metadata response has no access token");
  return data.access_token;
}

/**
 * Запрос к Document API YDB по протоколу DynamoDB (HTTP).
 * POST отправляется на сам endpoint (в нём уже зашит путь базы),
 * операция задаётся заголовком X-Amz-Target.
 */
async function docApi(
  target: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const token = await getIamToken();
  const response = await fetch(DOCUMENT_API_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Amz-Target": `DynamoDB_20120810.${target}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`YDB Document API ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!text) return undefined;
  return JSON.parse(text) as Record<string, unknown>;
}

export function toDynamoItem(lead: Lead): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: { S: lead.id },
    name: { S: lead.name },
    phone: { S: lead.phone },
    service: { S: lead.service },
    address: { S: lead.address },
    status: { S: lead.status ?? "new" },
    createdAt: { S: lead.createdAt },
  };
  if (lead.comment) {
    item.comment = { S: lead.comment };
  }
  return item;
}

export function fromDynamoItem(
  item: Record<string, { S?: string; N?: string; NULL?: boolean } | undefined>,
): Lead {
  const status = item.status?.S;
  return {
    id: item.id?.S ?? "",
    name: item.name?.S ?? "",
    phone: item.phone?.S ?? "",
    service: item.service?.S ?? "",
    address: item.address?.S ?? "",
    comment: item.comment?.S ?? null,
    // Старые записи без статуса считаем новыми
    status: status === "urgent" || status === "done" ? status : "new",
    createdAt: item.createdAt?.S ?? "",
  };
}

async function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await docApi("CreateTable", {
          TableName: TABLE_NAME,
          AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Таблица уже существует — это нормально
        if (!message.includes("ResourceInUseException")) {
          throw error;
        }
      }
    })();
  }
  await tableReady;
}

export async function createYdbLead(input: InsertLead): Promise<Lead> {
  await ensureTable();
  const lead: Lead = {
    id: randomUUID(),
    name: input.name,
    phone: input.phone,
    service: input.service,
    address: input.address,
    comment: input.comment ?? null,
    status: input.status ?? "new",
    createdAt: new Date().toISOString(),
  };
  await docApi("PutItem", { TableName: TABLE_NAME, Item: toDynamoItem(lead) });
  return lead;
}

export async function listYdbLeads(): Promise<Lead[]> {
  await ensureTable();
  const result = (await docApi("Scan", { TableName: TABLE_NAME })) as
    | { Items?: Record<string, Record<string, { S?: string; N?: string; NULL?: boolean }>>[] }
    | undefined;
  return (result?.Items ?? [])
    .map((item) => fromDynamoItem(item as Record<string, { S?: string; N?: string; NULL?: boolean }>))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateYdbLead(
  id: string,
  patch: Partial<InsertLead>,
): Promise<Lead | undefined> {
  const leads = await listYdbLeads();
  const current = leads.find((lead) => lead.id === id);
  if (!current) return undefined;
  const updated: Lead = { ...current, ...patch, comment: patch.comment ?? current.comment };
  await docApi("PutItem", { TableName: TABLE_NAME, Item: toDynamoItem(updated) });
  return updated;
}

export async function deleteYdbLead(id: string): Promise<boolean> {
  await ensureTable();
  await docApi("DeleteItem", { TableName: TABLE_NAME, Key: { id: { S: id } } });
  return true;
}

// --- Push-токены мобильного приложения (таблица devices) ---

const DEVICES_TABLE = "devices";

let devicesTableReady: Promise<void> | undefined;

async function ensureDevicesTable(): Promise<void> {
  if (!devicesTableReady) {
    devicesTableReady = (async () => {
      try {
        await docApi("CreateTable", {
          TableName: DEVICES_TABLE,
          AttributeDefinitions: [{ AttributeName: "token", AttributeType: "S" }],
          KeySchema: [{ AttributeName: "token", KeyType: "HASH" }],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Таблица уже существует — это нормально
        if (!message.includes("ResourceInUseException")) {
          throw error;
        }
      }
    })();
  }
  await devicesTableReady;
}

/** Сохранить (или обновить) push-токен устройства. */
export async function saveDeviceToken(token: string): Promise<void> {
  await ensureDevicesTable();
  await docApi("PutItem", {
    TableName: DEVICES_TABLE,
    Item: {
      token: { S: token },
      registeredAt: { S: new Date().toISOString() },
    },
  });
}

/** Список всех push-токенов устройств. */
export async function listDeviceTokens(): Promise<string[]> {
  await ensureDevicesTable();
  const result = (await docApi("Scan", { TableName: DEVICES_TABLE })) as
    | { Items?: Array<Record<string, { S?: string }>> }
    | undefined;
  return (result?.Items ?? [])
    .map((item) => item.token?.S)
    .filter((t): t is string => Boolean(t));
}

/** Удалить push-токен устройства (например, при выходе из приложения). */
export async function removeDeviceToken(token: string): Promise<void> {
  await ensureDevicesTable();
  await docApi("DeleteItem", {
    TableName: DEVICES_TABLE,
    Key: { token: { S: token } },
  });
}

// --- Настройки сайта (контент главной страницы, загруженные фото) ---
// Простая key-value таблица: в `value` лежит JSON-строка или data-url фото.

const SETTINGS_TABLE = "settings";

let settingsTableReady: Promise<void> | undefined;

async function ensureSettingsTable(): Promise<void> {
  if (!settingsTableReady) {
    settingsTableReady = (async () => {
      try {
        await docApi("CreateTable", {
          TableName: SETTINGS_TABLE,
          AttributeDefinitions: [{ AttributeName: "key", AttributeType: "S" }],
          KeySchema: [{ AttributeName: "key", KeyType: "HASH" }],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Таблица уже существует — это нормально
        if (!message.includes("ResourceInUseException")) {
          throw error;
        }
      }
    })();
  }
  await settingsTableReady;
}

export interface StoredSetting {
  value: string;
  updatedAt: string;
}

/** Прочитать настройку по ключу (key/value-таблица, документная модель YDB). */
export async function getYdbSetting(key: string): Promise<StoredSetting | undefined> {
  await ensureSettingsTable();
  const result = (await docApi("GetItem", {
    TableName: SETTINGS_TABLE,
    Key: { key: { S: key } },
  })) as
    | { Item?: Record<string, { S?: string }> }
    | undefined;
  const item = result?.Item;
  if (!item || item.value?.S === undefined) return undefined;
  return { value: item.value.S, updatedAt: item.updatedAt?.S ?? "" };
}

/** Сохранить настройку (создаст или перезапишет запись). */
export async function putYdbSetting(key: string, value: string): Promise<void> {
  await ensureSettingsTable();
  await docApi("PutItem", {
    TableName: SETTINGS_TABLE,
    Item: {
      key: { S: key },
      value: { S: value },
      updatedAt: { S: new Date().toISOString() },
    },
  });
}

/** Удалить настройку (например, фото героя при возврате к стандартному). */
export async function deleteYdbSetting(key: string): Promise<void> {
  await ensureSettingsTable();
  await docApi("DeleteItem", {
    TableName: SETTINGS_TABLE,
    Key: { key: { S: key } },
  });
}

// --- Заметки (мобильное приложение, таблица notes) ---

const NOTES_TABLE = "notes";

let notesTableReady: Promise<void> | undefined;

async function ensureNotesTable(): Promise<void> {
  if (!notesTableReady) {
    notesTableReady = (async () => {
      try {
        await docApi("CreateTable", {
          TableName: NOTES_TABLE,
          AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Таблица уже существует — это нормально
        if (!message.includes("ResourceInUseException")) {
          throw error;
        }
      }
    })();
  }
  await notesTableReady;
}

export interface Note {
  id: string;
  text: string;
  author: string;
  /** "0" — не выполнено, "1" — выполнено (в YDB храним строкой, как остальные поля). */
  done: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  text: string;
  author: string;
}

export type NotePatch = Partial<NoteInput> & { done?: string };

function toNoteItem(note: Note): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: { S: note.id },
    text: { S: note.text },
    author: { S: note.author },
    done: { S: note.done ?? "0" },
    createdAt: { S: note.createdAt },
    updatedAt: { S: note.updatedAt },
  };
  return item;
}

function fromNoteItem(
  item: Record<string, { S?: string; N?: string; NULL?: boolean } | undefined>,
): Note {
  return {
    id: item.id?.S ?? "",
    text: item.text?.S ?? "",
    author: item.author?.S ?? "",
    done: item.done?.S === "1" ? "1" : "0",
    createdAt: item.createdAt?.S ?? "",
    updatedAt: item.updatedAt?.S ?? "",
  };
}

export async function createYdbNote(input: NoteInput): Promise<Note> {
  await ensureNotesTable();
  const now = new Date().toISOString();
  const note: Note = {
    id: randomUUID(),
    text: input.text,
    author: input.author,
    done: "0",
    createdAt: now,
    updatedAt: now,
  };
  await docApi("PutItem", { TableName: NOTES_TABLE, Item: toNoteItem(note) });
  return note;
}

export async function listYdbNotes(): Promise<Note[]> {
  await ensureNotesTable();
  const result = (await docApi("Scan", { TableName: NOTES_TABLE })) as
    | { Items?: Record<string, Record<string, { S?: string; N?: string; NULL?: boolean }>>[] }
    | undefined;
  return (result?.Items ?? [])
    .map((item) => fromNoteItem(item as Record<string, { S?: string; N?: string; NULL?: boolean }>))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateYdbNote(
  id: string,
  patch: NotePatch,
): Promise<Note | undefined> {
  const notes = await listYdbNotes();
  const current = notes.find((note) => note.id === id);
  if (!current) return undefined;
  const updated: Note = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await docApi("PutItem", { TableName: NOTES_TABLE, Item: toNoteItem(updated) });
  return updated;
}

export async function deleteYdbNote(id: string): Promise<boolean> {
  await ensureNotesTable();
  await docApi("DeleteItem", { TableName: NOTES_TABLE, Key: { id: { S: id } } });
  return true;
}

// --- Чат между админами (мобильное приложение, таблица chat_messages) ---

const CHAT_TABLE = "chat_messages";

let chatTableReady: Promise<void> | undefined;

async function ensureChatTable(): Promise<void> {
  if (!chatTableReady) {
    chatTableReady = (async () => {
      try {
        await docApi("CreateTable", {
          TableName: CHAT_TABLE,
          AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Таблица уже существует — это нормально
        if (!message.includes("ResourceInUseException")) {
          throw error;
        }
      }
    })();
  }
  await chatTableReady;
}

export interface ChatMessage {
  id: string;
  sender: string;
  /** Адрес отправителя (улица, дом, подъезд). */
  address: string;
  text: string;
  createdAt: string;
  /** Если сообщение было отредактировано. */
  editedAt?: string;
}

export interface ChatMessageInput {
  sender: string;
  address: string;
  text: string;
}

function toChatItem(message: ChatMessage): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: { S: message.id },
    sender: { S: message.sender },
    address: { S: message.address ?? "" },
    text: { S: message.text },
    createdAt: { S: message.createdAt },
  };
  if (message.editedAt) {
    item.editedAt = { S: message.editedAt };
  }
  return item;
}

function fromChatItem(
  item: Record<string, { S?: string; N?: string; NULL?: boolean } | undefined>,
): ChatMessage {
  return {
    id: item.id?.S ?? "",
    sender: item.sender?.S ?? "",
    address: item.address?.S ?? "",
    text: item.text?.S ?? "",
    createdAt: item.createdAt?.S ?? "",
    editedAt: item.editedAt?.S || undefined,
  };
}

export async function sendYdbChatMessage(input: ChatMessageInput): Promise<ChatMessage> {
  await ensureChatTable();
  const message: ChatMessage = {
    id: randomUUID(),
    sender: input.sender,
    address: input.address ?? "",
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  await docApi("PutItem", { TableName: CHAT_TABLE, Item: toChatItem(message) });
  return message;
}

export async function listYdbChatMessages(
  after?: string,
  limit = 200,
): Promise<ChatMessage[]> {
  await ensureChatTable();
  const result = (await docApi("Scan", { TableName: CHAT_TABLE })) as
    | { Items?: Record<string, Record<string, { S?: string; N?: string; NULL?: boolean }>>[] }
    | undefined;
  const all = (result?.Items ?? [])
    .map((item) => fromChatItem(item as Record<string, { S?: string; N?: string; NULL?: boolean }>))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const filtered = after ? all.filter((m) => m.createdAt > after) : all;
  // Возвращаем последние `limit` сообщений (по возрастанию времени).
  return filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
}

export async function updateYdbChatMessage(
  id: string,
  patch: { text?: string },
): Promise<ChatMessage | undefined> {
  await ensureChatTable();
  const messages = await listYdbChatMessages();
  const current = messages.find((m) => m.id === id);
  if (!current) return undefined;
  const updated: ChatMessage = {
    ...current,
    text: patch.text ?? current.text,
    editedAt: new Date().toISOString(),
  };
  await docApi("PutItem", { TableName: CHAT_TABLE, Item: toChatItem(updated) });
  return updated;
}

export async function deleteYdbChatMessage(id: string): Promise<boolean> {
  await ensureChatTable();
  await docApi("DeleteItem", { TableName: CHAT_TABLE, Key: { id: { S: id } } });
  return true;
}

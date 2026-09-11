import { randomUUID } from "crypto";
import { Driver } from "@ydbjs/core";
import { CredentialsProvider } from "@ydbjs/auth";
import { query, type QueryClient } from "@ydbjs/query";
import { Optional } from "@ydbjs/value/optional";
import { Text, TextType } from "@ydbjs/value/primitive";
import { scanDocApiTable, type DocApiItem } from "./docapi";
import type { InsertLead, Lead, LeadStatus, LeadSource } from "@shared/schema";

// ---------------------------------------------------------------------------
// Подключение к YDB по YQL (обычные реляционные таблицы).
//
// ВАЖНО: раньше данные жили в документных таблицах (Document API, совместимый
// с DynamoDB) — их нельзя менять через YQL, а атрибуты не были колонками.
// Теперь сервер работает с обычными строковыми таблицами YQL с префиксом
// `yql_` (yql_leads, yql_notes, ...). Старые документные таблицы (leads,
// devices, ...) остаются нетронутыми как резервная копия — их можно удалить
// через консоль YDB после того, как всё проверим.
// ---------------------------------------------------------------------------

const DATABASE_PATH =
  process.env.YDB_DATABASE_PATH ??
  "/ru-central1/b1gpj9488h3k7oaa3foh/etn1ah45qvisdme7mftg";
const YDB_ENDPOINT = (
  process.env.YDB_ENDPOINT ?? "grpcs://ydb.serverless.yandexcloud.net:2135"
).replace(/\/+$/, "");

/** Имена новых YQL-таблиц (константы, в запросы подставляются как идентификаторы). */
const T = {
  leads: "yql_leads",
  devices: "yql_devices",
  settings: "yql_settings",
  notes: "yql_notes",
  chat: "yql_chat_messages",
  reviews: "yql_reviews",
} as const;

/** Получить IAM-токен сервис-аккаунта: из окружения (локально) или метаданных (в контейнере). */
async function fetchIamToken(): Promise<{ token: string; expiresInMs: number }> {
  const explicit = process.env.YC_IAM_TOKEN;
  if (explicit) {
    // Для явного токена срок неизвестен — считаем 12 часов и обновляем заранее.
    return { token: explicit, expiresInMs: 12 * 60 * 60 * 1000 };
  }
  const response = await fetch(
    "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!response.ok) {
    throw new Error(`Yandex metadata token request failed: ${response.status}`);
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Yandex metadata response has no access token");
  }
  return {
    token: data.access_token,
    expiresInMs: (data.expires_in ?? 3600) * 1000,
  };
}

/**
 * Провайдер IAM-токена для @ydbjs: кэширует токен и обновляет его
 * заранее (за 5 минут до истечения), чтобы драйвер не ловил 401.
 */
class YandexMetadataCredentialsProvider extends CredentialsProvider {
  private token = "";
  private expiresAt = 0;

  async getToken(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.token && now < this.expiresAt - 5 * 60_000) {
      return this.token;
    }
    const fetched = await fetchIamToken();
    this.token = fetched.token;
    this.expiresAt = now + fetched.expiresInMs;
    return this.token;
  }
}

let sqlClient: QueryClient | undefined;
let sqlReady: Promise<QueryClient> | undefined;

/** Единый QueryClient на процесс (драйвер сам держит пул сессий). */
async function getSql(): Promise<QueryClient> {
  if (!sqlClient) {
    sqlReady ??= (async () => {
      const driver = new Driver(`${YDB_ENDPOINT}${DATABASE_PATH}`, {
        credentialsProvider: new YandexMetadataCredentialsProvider(),
      });
      await driver.ready();
      sqlClient = query(driver);
      return sqlClient;
    })();
    sqlClient = await sqlReady;
  }
  return sqlClient;
}

type Row = Record<string, unknown>;

/** Безопасно достать строку из строки результата (NULL и не-строки → ""). */
function str(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

/**
 * Обернуть nullable-строку в YDB Optional<Utf8> для параметра запроса:
 * JS null в шаблонах @ydbjs не поддерживается напрямую.
 */
function optStr(value: string | null): Optional<TextType> {
  return value === null
    ? new Optional(null, new TextType())
    : new Optional(new Text(value));
}

// ---------------------------------------------------------------------------
// Создание таблиц при первом обращении (аналог прежнего ensureTable).
// Таблицы уже могут существовать (их создаёт миграция из консоли) —
// IF NOT EXISTS делает вызов безопасным.
// ---------------------------------------------------------------------------

let tablesReady: Promise<void> | undefined;

async function ensureTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      const sql = await getSql();
      // Каждый шаг — в отдельном try/catch: одна неудачная операция DDL
      // не должна ронять весь сервер (все запросы к БД проходят через
      // ensureTables). Ошибки логируем — по логам видно, что именно не удалось.
      const step = async (
        name: string,
        fn: () => unknown,
      ): Promise<void> => {
        try {
          await fn();
        } catch (err) {
          console.error(`[ydb] Не удалось выполнить «${name}»:`, err);
        }
      };
      await step("create leads", () => sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(T.leads)} (
          id Utf8 NOT NULL,
          name Utf8 NOT NULL,
          phone Utf8 NOT NULL,
          service Utf8 NOT NULL,
          address Utf8 NOT NULL,
          comment Utf8,
          status Utf8 NOT NULL,
          source Utf8 NOT NULL,
          archived Utf8 NOT NULL,
          createdAt Utf8 NOT NULL,
          PRIMARY KEY (id)
        )
      `);
      await step("create devices", () => sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(T.devices)} (
          token Utf8 NOT NULL,
          registeredAt Utf8 NOT NULL,
          PRIMARY KEY (token)
        )
      `);
      await step("create settings", () => sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(T.settings)} (
          key Utf8 NOT NULL,
          value Utf8 NOT NULL,
          updatedAt Utf8 NOT NULL,
          PRIMARY KEY (key)
        )
      `);
      await step("create notes", () => sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(T.notes)} (
          id Utf8 NOT NULL,
          text Utf8 NOT NULL,
          author Utf8 NOT NULL,
          done Utf8 NOT NULL,
          createdAt Utf8 NOT NULL,
          updatedAt Utf8 NOT NULL,
          leadId Utf8,
          PRIMARY KEY (id)
        )
      `);
      await step("create chat", () => sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(T.chat)} (
          id Utf8 NOT NULL,
          sender Utf8 NOT NULL,
          address Utf8 NOT NULL,
          text Utf8 NOT NULL,
          createdAt Utf8 NOT NULL,
          editedAt Utf8,
          image Utf8,
          PRIMARY KEY (id)
        )
      `);
      // Для таблиц, созданных до появления фото: добавляем колонку.
      // Колонка уже существует — это нормально, пропускаем.
      await step("alter chat add image", () =>
        sql`ALTER TABLE ${sql.identifier(T.chat)} ADD COLUMN image Utf8`,
      );
      // Привязка заметок к заявкам: колонка появилась позже создания таблицы.
      // Пробуем два синтаксиса — на случай, если первый не принимается.
      await step("alter notes add leadId (Utf8)", () =>
        sql`ALTER TABLE ${sql.identifier(T.notes)} ADD COLUMN leadId Utf8`,
      );
      await step("alter notes add leadId (Optional<Utf8>)", () =>
        sql`ALTER TABLE ${sql.identifier(T.notes)} ADD COLUMN leadId Optional<Utf8>`,
      );
      await step("create reviews", () => sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(T.reviews)} (
          id Utf8 NOT NULL,
          name Utf8 NOT NULL,
          city Utf8 NOT NULL,
          rating Utf8 NOT NULL,
          text Utf8 NOT NULL,
          status Utf8 NOT NULL,
          createdAt Utf8 NOT NULL,
          PRIMARY KEY (id)
        )
      `);
      // Таблицы готовы — запускаем одноразовый перенос данных из старых
      // документных таблиц (не ждём: миграция идёт в фоне и повторяется
      // при следующем обращении, если вдруг не удалась).
      void runDocApiMigration().catch((err) =>
        console.error(
          "Не удалось перенести данные из документных таблиц (повторим при следующем обращении):",
          err,
        ),
      );
    })();
  }
  await tablesReady;
}

// ---------------------------------------------------------------------------
// Одноразовая миграция: старые документные таблицы (Document API) → yql_*
//
// Через YQL атрибуты документных таблиц прочитать нельзя, поэтому читаем их
// через Document API (server/docapi.ts) и перекладываем в обычные YQL-таблицы.
// Идемпотентно: UPSERT по тому же ключу просто перезаписывает строку, маркер
// в настройках защищает от повторного полного прогона.
// ---------------------------------------------------------------------------

/** Имена старых документных таблиц в базе. */
const DOCAPI_TABLES = {
  leads: "leads",
  devices: "devices",
  settings: "settings",
  notes: "notes",
  chat: "chat_messages",
  reviews: "reviews",
} as const;

/** Ключ в yql_settings: миграция уже завершена (дата ISO). */
const MIGRATION_MARKER_KEY = "migration:docapi:done";

/** Элемент документной таблицы leads → заявка (те же умолчания, что и раньше). */
function docApiItemToLead(item: DocApiItem): Lead {
  const status = item.status?.S;
  return {
    id: item.id?.S ?? "",
    name: item.name?.S ?? "",
    phone: item.phone?.S ?? "",
    service: item.service?.S ?? "",
    address: item.address?.S ?? "",
    comment: item.comment?.S ?? null,
    status: status === "urgent" || status === "done" ? status : "new",
    source: item.source?.S === "admin" ? "admin" : "site",
    archived: item.archived?.S === "1" ? "1" : "0",
    createdAt: item.createdAt?.S ?? "",
  };
}

/** Перенести все данные из старых документных таблиц в новые yql_*. */
async function migrateDocApiToYql(): Promise<void> {
  const sql = await getSql();

  // Заявки
  const oldLeads = await scanDocApiTable(DOCAPI_TABLES.leads);
  for (const item of oldLeads) {
    const lead = docApiItemToLead(item);
    await sql`
      UPSERT INTO ${sql.identifier(T.leads)}
        (id, name, phone, service, address, comment, status, source, archived, createdAt)
      VALUES
        (${lead.id}, ${lead.name}, ${lead.phone}, ${lead.service}, ${lead.address},
         ${optStr(lead.comment)}, ${lead.status}, ${lead.source}, ${lead.archived}, ${lead.createdAt})
    `;
  }

  // Push-токены
  const oldDevices = await scanDocApiTable(DOCAPI_TABLES.devices);
  for (const item of oldDevices) {
    await sql`
      UPSERT INTO ${sql.identifier(T.devices)} (token, registeredAt)
      VALUES (${item.token?.S ?? ""}, ${item.registeredAt?.S ?? ""})
    `;
  }

  // Настройки сайта (контент главной страницы, фото)
  const oldSettings = await scanDocApiTable(DOCAPI_TABLES.settings);
  for (const item of oldSettings) {
    await sql`
      UPSERT INTO ${sql.identifier(T.settings)} (key, value, updatedAt)
      VALUES (${item.key?.S ?? ""}, ${item.value?.S ?? ""}, ${item.updatedAt?.S ?? ""})
    `;
  }

  // Заметки
  const oldNotes = await scanDocApiTable(DOCAPI_TABLES.notes);
  for (const item of oldNotes) {
    await sql`
      UPSERT INTO ${sql.identifier(T.notes)} (id, text, author, done, createdAt, updatedAt)
      VALUES (${item.id?.S ?? ""}, ${item.text?.S ?? ""}, ${item.author?.S ?? ""},
              ${item.done?.S === "1" ? "1" : "0"}, ${item.createdAt?.S ?? ""}, ${item.updatedAt?.S ?? ""})
    `;
  }

  // Чат
  const oldChat = await scanDocApiTable(DOCAPI_TABLES.chat);
  for (const item of oldChat) {
    await sql`
      UPSERT INTO ${sql.identifier(T.chat)} (id, sender, address, text, createdAt, editedAt)
      VALUES (${item.id?.S ?? ""}, ${item.sender?.S ?? ""}, ${item.address?.S ?? ""},
              ${item.text?.S ?? ""}, ${item.createdAt?.S ?? ""}, ${optStr(item.editedAt?.S ?? null)})
    `;
  }

  // Отзывы
  const oldReviews = await scanDocApiTable(DOCAPI_TABLES.reviews);
  for (const item of oldReviews) {
    await sql`
      UPSERT INTO ${sql.identifier(T.reviews)} (id, name, city, rating, text, status, createdAt)
      VALUES (${item.id?.S ?? ""}, ${item.name?.S ?? ""}, ${item.city?.S ?? ""},
              ${item.rating?.S ?? "5"}, ${item.text?.S ?? ""},
              ${item.status?.S === "published" || item.status?.S === "hidden" ? item.status.S : "new"},
              ${item.createdAt?.S ?? ""})
    `;
  }
}

let migrationReady: Promise<void> | undefined;

/**
 * Одноразовый перенос данных из документных таблиц в yql_*.
 * Вызывается на старте сервера и лениво при каждом обращении к БД,
 * пока не завершится успешно (маркер в настройках).
 */
export async function runDocApiMigration(): Promise<void> {
  if (!migrationReady) {
    migrationReady = (async () => {
      const done = await getYdbSetting(MIGRATION_MARKER_KEY);
      if (done) return;
      await migrateDocApiToYql();
      await putYdbSetting(MIGRATION_MARKER_KEY, new Date().toISOString());
      console.log("Миграция документных таблиц в yql_* завершена");
    })().catch((err) => {
      // Даём шанс повторить при следующем обращении (миграция идемпотентна)
      migrationReady = undefined;
      throw err;
    });
  }
  await migrationReady;
}

// ---------------------------------------------------------------------------
// Заявки (таблица yql_leads)
// ---------------------------------------------------------------------------

/** Превратить строку YQL в объект заявки (с теми же умолчаниями, что и раньше). */
function rowToLead(row: Row): Lead {
  const status: LeadStatus =
    row.status === "urgent" || row.status === "done" ? row.status : "new";
  const source: LeadSource = row.source === "admin" ? "admin" : "site";
  return {
    id: str(row, "id"),
    name: str(row, "name"),
    phone: str(row, "phone"),
    service: str(row, "service"),
    address: str(row, "address"),
    comment: row.comment == null ? null : str(row, "comment"),
    status,
    source,
    // Записи без атрибута считаем активными
    archived: row.archived === "1" ? "1" : "0",
    createdAt: str(row, "createdAt"),
  };
}

export async function createYdbLead(input: InsertLead): Promise<Lead> {
  await ensureTables();
  const sql = await getSql();
  const lead: Lead = {
    id: randomUUID(),
    name: input.name,
    phone: input.phone,
    service: input.service,
    address: input.address,
    comment: input.comment ?? null,
    status: input.status ?? "new",
    source: input.source ?? "site",
    archived: input.archived ?? "0",
    createdAt: new Date().toISOString(),
  };
  await sql`
    UPSERT INTO ${sql.identifier(T.leads)}
      (id, name, phone, service, address, comment, status, source, archived, createdAt)      VALUES
        (${lead.id}, ${lead.name}, ${lead.phone}, ${lead.service}, ${lead.address},
         ${optStr(lead.comment)}, ${lead.status}, ${lead.source}, ${lead.archived}, ${lead.createdAt})
    `;
  return lead;
}

export async function listYdbLeads(): Promise<Lead[]> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`
    SELECT id, name, phone, service, address, comment, status, source, archived, createdAt
    FROM ${sql.identifier(T.leads)}
  `;
  return ((result[0] ?? []) as Row[])
    .map((row) => rowToLead(row))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateYdbLead(
  id: string,
  patch: Partial<InsertLead>,
): Promise<Lead | undefined> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`
    SELECT id, name, phone, service, address, comment, status, source, archived, createdAt
    FROM ${sql.identifier(T.leads)}
    WHERE id = ${id}
  `;
  const row = (result[0] ?? [])[0] as Row | undefined;
  if (!row) return undefined;
  const current = rowToLead(row);
  const updated: Lead = { ...current, ...patch, comment: patch.comment ?? current.comment };
  await sql`
    UPSERT INTO ${sql.identifier(T.leads)}
      (id, name, phone, service, address, comment, status, source, archived, createdAt)      VALUES
        (${updated.id}, ${updated.name}, ${updated.phone}, ${updated.service}, ${updated.address},
         ${optStr(updated.comment)}, ${updated.status}, ${updated.source}, ${updated.archived}, ${updated.createdAt})
    `;
  return updated;
}

export async function deleteYdbLead(id: string): Promise<boolean> {
  await ensureTables();
  const sql = await getSql();
  await sql`DELETE FROM ${sql.identifier(T.leads)} WHERE id = ${id}`;
  return true;
}

// ---------------------------------------------------------------------------
// Push-токены мобильного приложения (таблица yql_devices)
// ---------------------------------------------------------------------------

/** Сохранить (или обновить) push-токен устройства. */
export async function saveDeviceToken(token: string): Promise<void> {
  await ensureTables();
  const sql = await getSql();
  await sql`
    UPSERT INTO ${sql.identifier(T.devices)} (token, registeredAt)
    VALUES (${token}, ${new Date().toISOString()})
  `;
}

/** Список всех push-токенов устройств. */
export async function listDeviceTokens(): Promise<string[]> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`SELECT token FROM ${sql.identifier(T.devices)}`;
  return ((result[0] ?? []) as Row[])
    .map((row) => str(row, "token"))
    .filter((t) => Boolean(t));
}

/** Удалить push-токен устройства (например, при выходе из приложения). */
export async function removeDeviceToken(token: string): Promise<void> {
  await ensureTables();
  const sql = await getSql();
  await sql`DELETE FROM ${sql.identifier(T.devices)} WHERE token = ${token}`;
}

// ---------------------------------------------------------------------------
// Настройки сайта (таблица yql_settings, key/value)
// ---------------------------------------------------------------------------

export interface StoredSetting {
  value: string;
  updatedAt: string;
}

/** Прочитать настройку по ключу. */
export async function getYdbSetting(key: string): Promise<StoredSetting | undefined> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`
    SELECT value, updatedAt FROM ${sql.identifier(T.settings)} WHERE key = ${key}
  `;
  const row = (result[0] ?? [])[0] as Row | undefined;
  if (!row) return undefined;
  return { value: str(row, "value"), updatedAt: str(row, "updatedAt") };
}

/** Сохранить настройку (создаст или перезапишет запись). */
export async function putYdbSetting(key: string, value: string): Promise<void> {
  await ensureTables();
  const sql = await getSql();
  await sql`
    UPSERT INTO ${sql.identifier(T.settings)} (key, value, updatedAt)
    VALUES (${key}, ${value}, ${new Date().toISOString()})
  `;
}

/** Удалить настройку (например, фото героя при возврате к стандартному). */
export async function deleteYdbSetting(key: string): Promise<void> {
  await ensureTables();
  const sql = await getSql();
  await sql`DELETE FROM ${sql.identifier(T.settings)} WHERE key = ${key}`;
}

// ---------------------------------------------------------------------------
// Заметки (таблица yql_notes)
// ---------------------------------------------------------------------------

export interface Note {
  id: string;
  text: string;
  author: string;
  /** "0" — не выполнено, "1" — выполнено (храним строкой, как остальные поля). */
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

export async function createYdbNote(input: NoteInput): Promise<Note> {
  await ensureTables();
  const sql = await getSql();
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
  try {
    await sql`
      UPSERT INTO ${sql.identifier(T.notes)} (id, text, author, done, createdAt, updatedAt, leadId)
      VALUES (${note.id}, ${note.text}, ${note.author}, ${note.done}, ${note.createdAt}, ${note.updatedAt}, ${optStr(note.leadId)})
    `;
  } catch {
    // Колонки leadId нет в таблице — сохраняем заметку без привязки
    note.leadId = null;
    await sql`
      UPSERT INTO ${sql.identifier(T.notes)} (id, text, author, done, createdAt, updatedAt)
      VALUES (${note.id}, ${note.text}, ${note.author}, ${note.done}, ${note.createdAt}, ${note.updatedAt})
    `;
  }
  return note;
}

export async function listYdbNotes(): Promise<Note[]> {
  await ensureTables();
  const sql = await getSql();
  let result;
  try {
    // Сначала пробуем с колонкой leadId; если её нет в таблице —
    // возвращаем заметки без привязки (leadId: null)
    result = await sql`
      SELECT id, text, author, done, createdAt, updatedAt, leadId FROM ${sql.identifier(T.notes)}
    `;
    return ((result[0] ?? []) as Row[])
      .map((row) => ({
        id: str(row, "id"),
        text: str(row, "text"),
        author: str(row, "author"),
        done: row.done === "1" ? "1" : "0",
        createdAt: str(row, "createdAt"),
        updatedAt: str(row, "updatedAt"),
        leadId: row.leadId == null ? null : str(row, "leadId"),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/column.*(leadId|not found)|no such column/i.test(msg)) throw err;
    result = await sql`
      SELECT id, text, author, done, createdAt, updatedAt FROM ${sql.identifier(T.notes)}
    `;
    return ((result[0] ?? []) as Row[])
      .map((row) => ({
        id: str(row, "id"),
        text: str(row, "text"),
        author: str(row, "author"),
        done: row.done === "1" ? "1" : "0",
        createdAt: str(row, "createdAt"),
        updatedAt: str(row, "updatedAt"),
        leadId: null,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export async function updateYdbNote(
  id: string,
  patch: NotePatch,
): Promise<Note | undefined> {
  await ensureTables();
  const sql = await getSql();
  let current: Note | undefined;
  try {
    current = await readNoteRow(id);
  } catch {
    // Колонки leadId нет в таблице — работаем без привязки
    current = await readNoteRowLegacy(id);
  }
  if (!current) return undefined;
  const updated: Note = {
    ...current,
    ...patch,
    leadId: patch.leadId === undefined ? current.leadId : patch.leadId,
    updatedAt: new Date().toISOString(),
  };
  try {
    await sql`
      UPSERT INTO ${sql.identifier(T.notes)} (id, text, author, done, createdAt, updatedAt, leadId)
      VALUES (${updated.id}, ${updated.text}, ${updated.author}, ${updated.done}, ${updated.createdAt}, ${updated.updatedAt}, ${optStr(updated.leadId)})
    `;
  } catch {
    await sql`
      UPSERT INTO ${sql.identifier(T.notes)} (id, text, author, done, createdAt, updatedAt)
      VALUES (${updated.id}, ${updated.text}, ${updated.author}, ${updated.done}, ${updated.createdAt}, ${updated.updatedAt})
    `;
  }
  return updated;
}

async function readNoteRow(id: string): Promise<Note | undefined> {
  const sql = await getSql();
  const result = await sql`
    SELECT id, text, author, done, createdAt, updatedAt, leadId FROM ${sql.identifier(T.notes)} WHERE id = ${id}
  `;
  const row = (result[0] ?? [])[0] as Row | undefined;
  if (!row) return undefined;
  return {
    id: str(row, "id"),
    text: str(row, "text"),
    author: str(row, "author"),
    done: row.done === "1" ? "1" : "0",
    createdAt: str(row, "createdAt"),
    updatedAt: str(row, "updatedAt"),
    leadId: row.leadId == null ? null : str(row, "leadId"),
  };
}

async function readNoteRowLegacy(id: string): Promise<Note | undefined> {
  const sql = await getSql();
  const result = await sql`
    SELECT id, text, author, done, createdAt, updatedAt FROM ${sql.identifier(T.notes)} WHERE id = ${id}
  `;
  const row = (result[0] ?? [])[0] as Row | undefined;
  if (!row) return undefined;
  return {
    id: str(row, "id"),
    text: str(row, "text"),
    author: str(row, "author"),
    done: row.done === "1" ? "1" : "0",
    createdAt: str(row, "createdAt"),
    updatedAt: str(row, "updatedAt"),
    leadId: null,
  };
}

export async function deleteYdbNote(id: string): Promise<boolean> {
  await ensureTables();
  const sql = await getSql();
  await sql`DELETE FROM ${sql.identifier(T.notes)} WHERE id = ${id}`;
  return true;
}

/** Отвязать от заявки все её заметки (при удалении заявки). */
export async function unlinkYdbNotesByLead(leadId: string): Promise<void> {
  await ensureTables();
  const sql = await getSql();
  try {
    const result = await sql`
      SELECT id, text, author, done, createdAt, updatedAt FROM ${sql.identifier(T.notes)} WHERE leadId = ${leadId}
    `;
    const rows = (result[0] ?? []) as Row[];
    for (const row of rows) {
      await sql`
        UPSERT INTO ${sql.identifier(T.notes)} (id, text, author, done, createdAt, updatedAt, leadId)
        VALUES (${str(row, "id")}, ${str(row, "text")}, ${str(row, "author")}, ${str(row, "done")}, ${str(row, "createdAt")}, ${str(row, "updatedAt")}, ${optStr(null)})
      `;
    }
  } catch {
    // Колонки leadId нет — отвязывать нечего, пропускаем
  }
}

// ---------------------------------------------------------------------------
// Чат между админами (таблица yql_chat_messages)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  sender: string;
  /** Адрес отправителя (улица, дом, подъезд). */
  address: string;
  text: string;
  createdAt: string;
  /** Если сообщение было отредактировано. */
  editedAt?: string;
  /** Фото в сообщении (data-url jpeg/png/webp, сжатое приложением). */
  image?: string;
}

export interface ChatMessageInput {
  sender: string;
  address: string;
  text: string;
  /** Необязательное фото (data-url). */
  image?: string;
}

export async function sendYdbChatMessage(input: ChatMessageInput): Promise<ChatMessage> {
  await ensureTables();
  const sql = await getSql();
  const message: ChatMessage = {
    id: randomUUID(),
    sender: input.sender,
    address: input.address ?? "",
    text: input.text,
    createdAt: new Date().toISOString(),
    ...(input.image ? { image: input.image } : {}),
  };
  await sql`
    UPSERT INTO ${sql.identifier(T.chat)} (id, sender, address, text, createdAt, image)
    VALUES (${message.id}, ${message.sender}, ${message.address}, ${message.text},
            ${message.createdAt}, ${optStr(message.image ?? null)})
  `;
  return message;
}

export async function listYdbChatMessages(
  after?: string,
  limit = 200,
): Promise<ChatMessage[]> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`
    SELECT id, sender, address, text, createdAt, editedAt, image FROM ${sql.identifier(T.chat)}
    ORDER BY createdAt
  `;
  const all = ((result[0] ?? []) as Row[]).map((row) => ({
    id: str(row, "id"),
    sender: str(row, "sender"),
    address: str(row, "address"),
    text: str(row, "text"),
    createdAt: str(row, "createdAt"),
    editedAt: row.editedAt == null ? undefined : str(row, "editedAt"),
    image: row.image == null ? undefined : str(row, "image"),
  }));
  const filtered = after ? all.filter((m) => m.createdAt > after) : all;
  // Возвращаем последние `limit` сообщений (по возрастанию времени).
  return filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
}

export async function updateYdbChatMessage(
  id: string,
  patch: { text?: string },
): Promise<ChatMessage | undefined> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`
    SELECT id, sender, address, text, createdAt, editedAt, image FROM ${sql.identifier(T.chat)} WHERE id = ${id}
  `;
  const row = (result[0] ?? [])[0] as Row | undefined;
  if (!row) return undefined;
  const current: ChatMessage = {
    id: str(row, "id"),
    sender: str(row, "sender"),
    address: str(row, "address"),
    text: str(row, "text"),
    createdAt: str(row, "createdAt"),
    editedAt: row.editedAt == null ? undefined : str(row, "editedAt"),
    image: row.image == null ? undefined : str(row, "image"),
  };
  const updated: ChatMessage = {
    ...current,
    text: patch.text ?? current.text,
    editedAt: new Date().toISOString(),
  };
  await sql`
    UPSERT INTO ${sql.identifier(T.chat)} (id, sender, address, text, createdAt, editedAt, image)
    VALUES (${updated.id}, ${updated.sender}, ${updated.address}, ${updated.text},
            ${updated.createdAt}, ${updated.editedAt}, ${optStr(updated.image ?? null)})
  `;
  return updated;
}

export async function deleteYdbChatMessage(id: string): Promise<boolean> {
  await ensureTables();
  const sql = await getSql();
  await sql`DELETE FROM ${sql.identifier(T.chat)} WHERE id = ${id}`;
  return true;
}

// ---------------------------------------------------------------------------
// Отзывы клиентов (таблица yql_reviews)
// ---------------------------------------------------------------------------

export type ReviewStatus = "new" | "published" | "hidden";

export interface Review {
  id: string;
  /** Имя автора (как он представился). */
  name: string;
  /** Город — необязательное поле. */
  city: string;
  /** Оценка от 1 до 5 (строкой, как остальные поля). */
  rating: string;
  /** Текст отзыва. */
  text: string;
  status: ReviewStatus;
  /** Ответ службы на отзыв; пустая строка — ответа нет. */
  reply: string;
  createdAt: string;
}

export interface ReviewInput {
  name: string;
  city: string;
  rating: string;
  text: string;
}

// --- Ответы службы на отзывы -----------------------------------------------
// Храним их в key/value таблице настроек (yql_settings) одним JSON-объектом:
//   ключ "review-replies" → { "<id отзыва>": "текст ответа" }
// Так для ответов НЕ нужна новая колонка в таблице отзывов: ALTER TABLE на
// проде применяется не всегда (из-за этого уже был инцидент с падением БД),
// а настройки работают сразу. Плата — одно чтение настроек при выдаче списка.
const REVIEW_REPLIES_KEY = "review-replies";

/** Читаем все ответы одним объектом (битый JSON — считаем, что ответов нет). */
async function readReviewReplies(): Promise<Record<string, string>> {
  try {
    const setting = await getYdbSetting(REVIEW_REPLIES_KEY);
    if (!setting?.value) return {};
    const parsed: unknown = JSON.parse(setting.value);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value) out[id] = value;
    }
    return out;
  } catch (err) {
    console.error("[ydb] Не удалось прочитать ответы на отзывы:", err);
    return {};
  }
}

/** Сохранить ответ на отзыв (пустая строка — убрать ответ). */
async function writeReviewReply(id: string, reply: string): Promise<void> {
  const replies = await readReviewReplies();
  if (reply) replies[id] = reply;
  else delete replies[id];
  await putYdbSetting(REVIEW_REPLIES_KEY, JSON.stringify(replies));
}

/** Удалить ответ вместе с отзывом (чтобы не оставлять мусора). */
async function dropReviewReply(id: string): Promise<void> {
  const replies = await readReviewReplies();
  if (!(id in replies)) return;
  delete replies[id];
  await putYdbSetting(REVIEW_REPLIES_KEY, JSON.stringify(replies));
}

/** Записать отзыв в YDB (без ответа — он живёт в настройках). */
async function upsertYdbReview(review: Review): Promise<void> {
  const sql = await getSql();
  await sql`
    UPSERT INTO ${sql.identifier(T.reviews)} (id, name, city, rating, text, status, createdAt)
    VALUES (${review.id}, ${review.name}, ${review.city}, ${review.rating}, ${review.text}, ${review.status}, ${review.createdAt})
  `;
}

/** Сохранить новый отзыв (всегда статус "new" — на модерации). */
export async function createYdbReview(input: ReviewInput): Promise<Review> {
  await ensureTables();
  const sql = await getSql();
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
  await upsertYdbReview(review);
  return review;
}

/** Все отзывы (для админки), новые — первыми. */
export async function listYdbReviews(): Promise<Review[]> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`
    SELECT id, name, city, rating, text, status, createdAt FROM ${sql.identifier(T.reviews)}
  `;
  const replies = await readReviewReplies();
  return ((result[0] ?? []) as Row[])
    .map((row) => {
      const status = str(row, "status");
      const id = str(row, "id");
      return {
        id,
        name: str(row, "name"),
        city: str(row, "city"),
        rating: str(row, "rating") || "5",
        text: str(row, "text"),
        // Неизвестный статус считаем «на модерации»
        status: (status === "published" || status === "hidden"
          ? status
          : "new") as ReviewStatus,
        reply: replies[id] ?? "",
        createdAt: str(row, "createdAt"),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Публичные отзывы (только опубликованные), новые — первыми. */
export async function listYdbPublishedReviews(): Promise<Review[]> {
  const all = await listYdbReviews();
  return all.filter((review) => review.status === "published");
}

export async function updateYdbReview(
  id: string,
  patch: Partial<Pick<Review, "status" | "reply">>,
): Promise<Review | undefined> {
  await ensureTables();
  const sql = await getSql();
  const result = await sql`
    SELECT id, name, city, rating, text, status, createdAt FROM ${sql.identifier(T.reviews)} WHERE id = ${id}
  `;
  const row = (result[0] ?? [])[0] as Row | undefined;
  if (!row) return undefined;
  const status = str(row, "status");
  const replies = await readReviewReplies();
  const current: Review = {
    id: str(row, "id"),
    name: str(row, "name"),
    city: str(row, "city"),
    rating: str(row, "rating") || "5",
    text: str(row, "text"),
    status: (status === "published" || status === "hidden" ? status : "new") as ReviewStatus,
    reply: replies[id] ?? "",
    createdAt: str(row, "createdAt"),
  };
  const updated: Review = {
    ...current,
    status: patch.status ?? current.status,
    reply: patch.reply ?? current.reply,
  };
  // Статус — в строку отзыва; ответ — в настройки (только если его меняли).
  if (patch.status !== undefined) {
    await upsertYdbReview(updated);
  }
  if (patch.reply !== undefined) {
    await writeReviewReply(id, updated.reply);
  }
  return updated;
}

export async function deleteYdbReview(id: string): Promise<boolean> {
  await ensureTables();
  const sql = await getSql();
  await sql`DELETE FROM ${sql.identifier(T.reviews)} WHERE id = ${id}`;
  // Ответ хранится отдельно — убираем и его, чтобы не копить мусор.
  await dropReviewReply(id).catch((err) =>
    console.error("[ydb] Не удалось удалить ответ на отзыв:", err),
  );
  return true;
}
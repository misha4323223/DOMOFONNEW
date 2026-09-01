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

async function getIamToken(): Promise<string> {
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
  return {
    id: item.id?.S ?? "",
    name: item.name?.S ?? "",
    phone: item.phone?.S ?? "",
    service: item.service?.S ?? "",
    address: item.address?.S ?? "",
    comment: item.comment?.S ?? null,
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

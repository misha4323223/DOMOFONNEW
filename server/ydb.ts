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

async function docApi(path: string, body: unknown): Promise<unknown> {
  const token = await getIamToken();
  const response = await fetch(`${DOCUMENT_API_ENDPOINT}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`YDB Document API ${response.status}: ${text.slice(0, 500)}`);
  }
  return response.json();
}

async function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await docApi("/v1/createTable", {
          path: TABLE_NAME,
          primary_key: ["id"],
          attributes: [
            { name: "id", type: "string", not_null: true },
            { name: "name", type: "string", not_null: true },
            { name: "phone", type: "string", not_null: true },
            { name: "service", type: "string", not_null: true },
            { name: "address", type: "string", not_null: true },
            { name: "comment", type: "string" },
            { name: "createdAt", type: "string", not_null: true },
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("already exists") && !message.includes("ALREADY_EXISTS")) {
          throw error;
        }
      }
    })();
  }
  await tableReady;
}

function rowToLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id),
    name: String(row.name),
    phone: String(row.phone),
    service: String(row.service),
    address: String(row.address),
    comment: row.comment == null ? null : String(row.comment),
    createdAt: String(row.createdAt),
  };
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
  await docApi("/v1/document", {
    statements: [
      {
        type: "INSERT",
        table: TABLE_NAME,
        values: [lead],
      },
    ],
  });
  return lead;
}

export async function listYdbLeads(): Promise<Lead[]> {
  await ensureTable();
  const result = (await docApi("/v1/document", {
    statements: [{ type: "SCAN", table: TABLE_NAME }],
  })) as { result?: { rows?: Record<string, unknown>[] } };
  return (result.result?.rows ?? [])
    .map(rowToLead)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateYdbLead(id: string, patch: Partial<InsertLead>): Promise<Lead | undefined> {
  const leads = await listYdbLeads();
  const current = leads.find((lead) => lead.id === id);
  if (!current) return undefined;
  const updated: Lead = { ...current, ...patch, comment: patch.comment ?? current.comment };
  await docApi("/v1/document", {
    statements: [{ type: "UPDATE", table: TABLE_NAME, key: { id }, values: updated }],
  });
  return updated;
}

export async function deleteYdbLead(id: string): Promise<boolean> {
  await ensureTable();
  await docApi("/v1/document", {
    statements: [{ type: "DELETE", table: TABLE_NAME, key: { id } }],
  });
  return true;
}

/**
 * Клиент Document API (DynamoDB-совместимый) для ЧТЕНИЯ старых документных
 * таблиц (leads, devices, settings, notes, chat_messages, reviews).
 *
 * Нужен только для одноразовой миграции данных в новые обычные YQL-таблицы
 * (yql_*). Через YQL атрибуты документных таблиц прочитать нельзя — поэтому
 * читаем их тем же способом, которым работало приложение раньше.
 */

const DATABASE_PATH =
  process.env.YDB_DATABASE_PATH ??
  "/ru-central1/b1gpj9488h3k7oaa3foh/etn1ah45qvisdme7mftg";
const DOCUMENT_API_ENDPOINT =
  process.env.YDB_DOCUMENT_API_ENDPOINT ??
  `https://docapi.serverless.yandexcloud.net${DATABASE_PATH}`;

/** Получить IAM-токен сервис-аккаунта: из окружения (локально) или метаданных (в контейнере). */
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

/** Элемент документной таблицы: имя атрибута → значение DynamoDB-типа. */
export interface DocApiItem {
  [key: string]: { S?: string; N?: string; NULL?: boolean } | undefined;
}

/**
 * Прочитать ВСЕ элементы документной таблицы (с учётом пагинации).
 * Scan дорогой, но таблицы маленькие и операция одноразовая.
 */
export async function scanDocApiTable(tableName: string): Promise<DocApiItem[]> {
  const items: DocApiItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = (await docApi("Scan", {
      TableName: tableName,
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    })) as
      | { Items?: DocApiItem[]; LastEvaluatedKey?: Record<string, unknown> }
      | undefined;
    items.push(...(result?.Items ?? []));
    exclusiveStartKey = result?.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}
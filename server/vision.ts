/**
 * Интеграция с Yandex Vision OCR (рукописный текст).
 *
 * Эндпоинт: POST https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText
 * Модель "handwritten" распознаёт произвольное сочетание рукописного
 * и печатного текста на русском и английском.
 *
 * Сервис-аккаунту контейнера нужна роль ai.vision.user на каталог,
 * указанный в x-folder-id (по умолчанию — каталог, где живёт YDB).
 */

// Yandex Vision требует, чтобы x-folder-id совпадал с каталогом сервис-аккаунта
// контейнера (b1g74qv3u70jmct1ekvf). Каталог YDB (b1gpj9488h3k7oaa3foh) тут не подойдёт —
// контейнер ответит "folder ID does not match".
const FOLDER_ID = process.env.YC_FOLDER_ID ?? "b1g74qv3u70jmct1ekvf";

const OCR_ENDPOINT = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText";

/** Получаем IAM-токен сервис-аккаунта контейнера (как для YDB). */
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

export interface RecognizedPage {
  /** Полный распознанный текст страницы (строки через \n). */
  fullText: string;
  /** Строки по порядку, как они идут на странице. */
  lines: string[];
}

/**
 * Распознаёт рукописный/печатный текст на изображении.
 * imageBase64 — base64 без префикса data:, mimeType — JPEG или PNG.
 */
export async function recognizeHandwritten(
  imageBase64: string,
  mimeType: "JPEG" | "PNG",
): Promise<RecognizedPage> {
  const token = await getIamToken();

  const response = await fetch(OCR_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-folder-id": FOLDER_ID,
      "x-data-logging-enabled": "true",
    },
    body: JSON.stringify({
      mimeType,
      languageCodes: ["ru", "en"],
      model: "handwritten",
      content: imageBase64,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Yandex Vision OCR ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = JSON.parse(text) as {
    result?: { textAnnotation?: { fullText?: string; blocks?: { lines?: { text?: string }[] }[] } };
  };

  const annotation = data.result?.textAnnotation;
  const fullText = annotation?.fullText ?? "";
  const lines: string[] = [];
  for (const block of annotation?.blocks ?? []) {
    for (const line of block.lines ?? []) {
      if (line.text) lines.push(line.text);
    }
  }

  return { fullText, lines };
}
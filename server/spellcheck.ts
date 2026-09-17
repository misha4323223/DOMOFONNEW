/**
 * Проверка орфографии для текстов сайта и ответов на отзывы.
 *
 * Проверяет LanguageTool (api.languagetool.org) — открытый сервис проверки
 * текста: бесплатный, без ключа, русский язык понимает. Клавиатура телефона
 * тоже подчёркивает ошибки, но только если у человека включена проверка в
 * настройках и только на самом устройстве; здесь же администратор получает
 * список ошибок с вариантами замены — и в приложении, и в вебе.
 *
 * Куда зовём: только редактор текстов сайта и ответы на отзывы. В заявках и
 * заметках проверку не предлагаем специально: текст уходит на внешний сервис,
 * а там бывают адреса и телефоны клиентов — это те же персональные данные,
 * что и в политике конфиденциальности.
 */

const LT_ENDPOINT = "https://api.languagetool.org/v2/check";

/** Ограничение сервиса — 20 КБ; держим с запасом, чтобы ответ приходил быстро. */
export const SPELLCHECK_MAX_LENGTH = 5000;

export interface SpellIssue {
  /** Смещение фрагмента в тексте (в символах) — по нему приложение подсвечивает. */
  offset: number;
  /** Длина фрагмента. */
  length: number;
  /** Сам фрагмент с ошибкой. */
  word: string;
  /** Пояснение сервиса («Возможно, имеется в виду…»). */
  message: string;
  /** Варианты замены, самый вероятный — первым. Пустой список — вариантов нет. */
  suggestions: string[];
}

interface LanguageToolMatch {
  offset?: number;
  length?: number;
  message?: string;
  replacements?: { value?: string }[];
}

/**
 * Проверить русский текст. Пустой текст и текст из одних цифр сервис всё равно
 * примет, но смысла в запросе нет — такие случаи отсекаем заранее.
 */
export async function checkRussianText(text: string): Promise<SpellIssue[]> {
  if (!text.trim()) return [];

  const body = new URLSearchParams({ text, language: "ru" });
  const response = await fetch(LT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // Сервис может отвечать долго: не держим запрос из приложения дольше 10 с.
    signal: AbortSignal.timeout(10_000),
  });

  const raw = await response.text();
  if (response.status === 429) {
    throw new Error("Сервис проверки перегружен, попробуйте через минуту");
  }
  if (!response.ok) {
    throw new Error(`LanguageTool ${response.status}: ${raw.slice(0, 200)}`);
  }

  let data: { matches?: LanguageToolMatch[] };
  try {
    data = JSON.parse(raw) as { matches?: LanguageToolMatch[] };
  } catch {
    throw new Error("Сервис проверки вернул непонятный ответ");
  }

  const issues: SpellIssue[] = [];
  for (const match of data.matches ?? []) {
    const offset = match.offset ?? 0;
    const length = match.length ?? 0;
    if (length <= 0 || offset < 0 || offset + length > text.length) continue;

    const suggestions = (match.replacements ?? [])
      .map((r) => r.value ?? "")
      .filter((value) => value.length > 0)
      .slice(0, 5);

    issues.push({
      offset,
      length,
      word: text.slice(offset, offset + length),
      message: match.message ?? "Возможно, здесь ошибка",
      suggestions,
    });
  }

  // По порядку в тексте: так удобнее читать список и подсвечивать.
  issues.sort((a, b) => a.offset - b.offset);
  return issues;
}

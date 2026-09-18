/**
 * Тексты голосовых подсказок — чистые функции, без нативных модулей.
 *
 * Их удобно проверять тестом и править: «Как это звучит за рулём?» — вопрос
 * к тексту, а не к движку речи. Сам синтез живёт в voice.ts.
 */

/** «километр», «километра», «километров» — с учётом дробных. */
export function kilometerWord(value: number): string {
  // Дробное (1,2 км) всегда читается как «километра»
  if (!Number.isInteger(value)) return "километра";
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return "километр";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "километра";
  return "километров";
}

/** «1,2 километра» — как это произносят. Дробную часть — через запятую. */
export function kilometerLabel(meters: number): string {
  const km = Math.round(meters / 100) / 10;
  const value = km < 10 ? km : Math.round(km);
  const text = Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  return `${text} ${kilometerWord(value)}`;
}

/** «через 300 метров» / «через 1,2 километра» / «сейчас». */
export function distancePhrase(meters: number): string {
  if (meters < 60) return "сейчас";
  if (meters < 1000) return `через ${Math.round(meters / 50) * 50} метров`;
  return `через ${kilometerLabel(meters)}`;
}

/** Что делаем по подсказке — человеческими словами. */
export function maneuverAction(text: string): string {
  switch (text) {
    case "налево":
      return "поверните налево";
    case "резко налево":
      return "резко поверните налево";
    case "направо":
      return "поверните направо";
    case "резко направо":
      return "резко поверните направо";
    case "правее":
      return "держитесь правее";
    case "левее":
      return "держитесь левее";
    case "съезд":
      return "поверните на съезд";
    case "по кругу":
      return "продолжайте по кругу";
    case "разворот":
      return "развернитесь";
    case "слияние":
      return "продолжайте по главной дороге";
    case "прибытие":
      return "вы прибыли";
    default:
      // «прямо», «развилка», «выезд на трассу» и всё незнакомое — лучше
      // сказать «продолжайте движение», чем соврать про поворот.
      return "продолжайте движение";
  }
}

/**
 * Фраза про ближайший поворот: «Через 300 метров поверните направо на Ленина».
 *
 * meters — сколько осталось до маневра, street — улица от маршрутизатора
 * (она приходит без падежа, поэтому просто называем её после «на»).
 */
export function maneuverPhrase(text: string, street: string, meters: number): string {
  const action = maneuverAction(text);
  const when = distancePhrase(meters);
  const place = street
    ? action.startsWith("держитесь")
      ? ` по ${street}`
      : ` на ${street}`
    : "";
  if (when === "сейчас") return `Сейчас ${action}${place}`;
  const head = when.charAt(0).toUpperCase() + when.slice(1);
  return `${head} ${action}${place}`;
}

/** «Следующая — Ленина 5, через 3 километра»: объявляем при переходе к точке. */
export function nextStopPhrase(address: string, meters: number | null): string {
  const where = address.trim() || "адрес не указан";
  if (meters === null || meters < 100) return `Следующая — ${where}`;
  return `Следующая — ${where}, ${distancePhrase(meters)}`;
}

/** «Вы на месте» — объявляем у точки. */
export function arrivalPhrase(): string {
  return "Вы на месте";
}

// Control numérico: CÓDIGO, no modelo. Todo número y todo link de la respuesta tiene que
// estar en los datos que se le dieron al redactor (fichas, info del negocio) o en lo que dijo el cliente.

const URL_RE = /https?:\/\/[^\s)>\]]+/gi;
const WORDS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cien: 100,
};
// 59.000 | 1.500.000,50 | 4900 | 1,5 | 2.5   + "mil" / "k" / "millones"
const NUM_RE = /(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(\s*(?:mil\b|k\b|millones\b|mill[oó]n\b|palos\b))?/gi;

function parseToken(raw: string, mult: string | undefined): number {
  let n: number;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) n = Number(raw.replace(/\./g, "").replace(",", "."));
  else if (/^\d+,\d+$/.test(raw)) n = Number(raw.replace(",", "."));
  else if (/^\d+\.\d+$/.test(raw)) n = Number(raw);
  else n = Number(raw);
  const m = mult?.trim().toLowerCase();
  if (m === "mil" || m === "k") n *= 1_000;
  else if (m && /^(millones|mill[oó]n|palos)$/.test(m)) n *= 1_000_000;
  return Math.round(n * 100) / 100;
}

/** Números que aparecen en un texto (sin contar los que están dentro de links). */
export function extractNumbers(text: string): number[] {
  const clean = text
    .replace(URL_RE, " ")
    .replace(/m(?:ts?)?(?:2|²)(?!\d)/gi, " m ") // la unidad "m2" no es un número ("233m2", "700 m²")
    .replace(/\d️?⃣/g, " ")       // emojis 1️⃣ 2️⃣
    .replace(/^\s*\d{1,2}[.)-]\s/gm, " ");  // viñetas "1. " "2) "
  const out: number[] = [];
  for (const m of clean.matchAll(NUM_RE)) out.push(parseToken(m[1]!, m[2]));
  const lower = clean.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [w, n] of Object.entries(WORDS)) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) out.push(n);
  }
  return out;
}

export const extractUrls = (text: string) => [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?]+$/, ""));

/** Todos los valores de texto/número de un objeto (no las claves: "superficie_total_m2" no aporta un 2). */
function values(x: unknown, acc: string[] = []): string[] {
  if (x == null) return acc;
  if (typeof x === "string" || typeof x === "number") acc.push(String(x));
  else if (Array.isArray(x)) x.forEach((v) => values(v, acc));
  else if (typeof x === "object") Object.values(x as Record<string, unknown>).forEach((v) => values(v, acc));
  return acc;
}

export interface NumericCheck { ok: boolean; unknownNumbers: number[]; unknownUrls: string[] }

/**
 * @param reply   respuesta propuesta
 * @param sources datos permitidos (fichas, info del negocio) y mensajes del cliente
 * @param maxCount cantidad de opciones mostradas: "te paso 3 opciones" es válido hasta ese número
 */
export function checkNumbers(reply: string, sources: unknown[], maxCount = 0): NumericCheck {
  const texts = values(sources);
  const allowed = new Set<number>([0, 1]);
  for (let i = 1; i <= maxCount; i++) allowed.add(i);
  for (const t of texts) for (const n of extractNumbers(t)) allowed.add(n);
  const allowedUrls = new Set(texts.flatMap(extractUrls));

  const unknownNumbers = [...new Set(extractNumbers(reply).filter((n) => !allowed.has(n)))];
  const unknownUrls = extractUrls(reply).filter((u) => !allowedUrls.has(u));
  return { ok: unknownNumbers.length === 0 && unknownUrls.length === 0, unknownNumbers, unknownUrls };
}

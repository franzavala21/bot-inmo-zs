// Extractor (agente con IA). Contrato:
// - Objetivo: armar la ficha del lead con lo que dijo el cliente, cada dato con su frase textual.
// - Límites: no le escribe al cliente, no puntúa, no inventa. El código descarta todo dato cuya frase no esté en los mensajes del cliente.
// - Formato: ExtractedLead (zod).
// - Salida de emergencia: si falla, la ficha queda como estaba y se anota en la bitácora.
import { z } from "zod";
import { INJECTION_GUARD, renderHistory } from "../bot/agents";
import type { Llm, Usage } from "../bot/llm";
import { PROMPTS } from "../bot/prompts.generated";
import type { HistoryMsg } from "../bot/types";

const q = <T extends z.ZodTypeAny>(value: T) => z.object({ value, quote: z.string() }).nullable();

export const ExtractedLead = z.object({
  operation: q(z.enum(["sale", "rent"])),
  zones: q(z.array(z.string())),
  property_type: q(z.string()),
  budget_max: q(z.number()),
  budget_currency: q(z.enum(["USD", "ARS"])),
  rooms_min: q(z.number().int()),
  pets: q(z.boolean()),
  timeframe: q(z.number().int()),
  financing: q(z.enum(["cash", "needs_credit", "needs_to_sell", "other"])),
  name: q(z.string()),
  wants_visit: q(z.boolean()),
});
export type ExtractedLead = z.infer<typeof ExtractedLead>;
export const LEAD_FIELDS = Object.keys(ExtractedLead.shape) as (keyof ExtractedLead)[];

export const EXTRACTOR_REQUIRED = ["{{GUARDIA}}", "{{HOY}}"] as const;
export function buildExtractorPrompt(today: Date, template: string = PROMPTS.extractor): string {
  const missing = EXTRACTOR_REQUIRED.filter((k) => !template.includes(k));
  if (missing.length) throw new Error(`prompt del extractor incompleto: falta ${missing.join(", ")}`);
  const hoy = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Cordoba", day: "numeric", month: "long", year: "numeric" }).format(today);
  return template.replaceAll("{{GUARDIA}}", INJECTION_GUARD).replaceAll("{{HOY}}", hoy);
}

/** Minúsculas, sin acentos ni signos, espacios simples: para comparar frases sin depender de detalles. */
export function normalizeQuote(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Deja solo los datos cuya frase está de verdad en algún mensaje del cliente. Devuelve también los descartados. */
export function keepQuoted(x: ExtractedLead, history: HistoryMsg[]): { data: ExtractedLead; dropped: string[] } {
  const clientText = history.filter((m) => m.author === "client" && m.text).map((m) => normalizeQuote(m.text!));
  const data = { ...x };
  const dropped: string[] = [];
  for (const f of LEAD_FIELDS) {
    const v = data[f];
    if (!v) continue;
    const quote = normalizeQuote(v.quote);
    const empty = Array.isArray(v.value) ? v.value.length === 0 : v.value === "" || v.value === null;
    if (empty || quote.length < 2 || !clientText.some((t) => t.includes(quote))) {
      (data as Record<string, unknown>)[f] = null;
      dropped.push(f);
    }
  }
  return { data, dropped };
}

export async function extractLead(llm: Llm, history: HistoryMsg[], today = new Date()): Promise<{ data: ExtractedLead; dropped: string[]; usage: Usage }> {
  const r = await llm.structured({
    name: "ficha", schema: ExtractedLead, system: buildExtractorPrompt(today),
    user: `CONVERSACIÓN:\n${renderHistory(history)}`, temperature: 0,
  });
  return { ...keepQuoted(r.data, history), usage: r.usage };
}

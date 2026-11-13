// Matcher (código, sin modelo): cruza propiedades con las fichas de los leads y explica cada coincidencia.
// Arma borradores de aviso que un dueño aprueba de a uno. Nunca envía nada solo.
// Privacidad: los logs llevan solo ids.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_COLUMNS } from "../retrieval/search";
import { toFact, type PublicRow } from "../bot/facts";
import { normalizeQuote } from "./extract";
import { SERVICE_WINDOW_MS } from "../transport/meta-dispatch";
import { profileFromRow } from "./run";
import type { Profile } from "./profile";

/** Hasta cuánto por encima del presupuesto se acepta (10 %): un poco arriba igual puede interesar. */
export const BUDGET_TOLERANCE = 0.1;
/** Mínimo de criterios que tienen que coincidir (de tipo, zona y presupuesto) para que valga la pena avisar. */
export const MIN_CRITERIA = 2;

const fmt = (n: number) => new Intl.NumberFormat("es-AR").format(n);

export interface MatchResult { ok: boolean; reasons: string[]; criteria: number }

/** ¿Esta propiedad le sirve a este lead? Cada dato conocido de la ficha tiene que cumplirse. */
export function matchReasons(p: Pick<PublicRow, "operation" | "property_type" | "zone" | "price" | "currency" | "bedrooms">, prof: Profile): MatchResult {
  const reasons: string[] = [];
  let criteria = 0;
  const v = <T>(f: keyof Profile) => (prof[f]?.value ?? null) as T | null;

  const op = v<string>("operation");
  if (op && p.operation && op !== p.operation) return { ok: false, reasons: ["Busca otra operación"], criteria };

  const type = v<string>("property_type");
  if (type) {
    const a = normalizeQuote(type), b = normalizeQuote(p.property_type ?? "");
    if (!b || !(b.includes(a) || a.includes(b))) return { ok: false, reasons: [`Busca ${type}`], criteria };
    reasons.push(`Tipo: busca ${type} y es ${p.property_type}`); criteria++;
  }

  const zones = v<string[]>("zones");
  if (zones?.length) {
    const z = normalizeQuote(p.zone ?? "");
    const hit = zones.find((x) => { const n = normalizeQuote(x); return !!z && (z.includes(n) || n.includes(z)); });
    if (!hit) return { ok: false, reasons: [`Busca en ${zones.join(", ")}`], criteria };
    reasons.push(`Zona: busca en ${hit} y está en ${p.zone}`); criteria++;
  }

  const budget = v<number>("budget_max");
  if (budget) {
    const cur = v<string>("budget_currency");
    if (!p.price) return { ok: false, reasons: ["La propiedad no tiene precio publicado"], criteria };
    if (cur && p.currency && cur !== p.currency) return { ok: false, reasons: [`Su presupuesto es en ${cur} y la propiedad en ${p.currency}`], criteria };
    if (p.price > budget * (1 + BUDGET_TOLERANCE)) return { ok: false, reasons: ["Se pasa de su presupuesto"], criteria };
    const over = p.price > budget ? ` (${Math.round((p.price / budget - 1) * 100)} % arriba)` : "";
    reasons.push(`Precio: ${p.currency ?? ""} ${fmt(p.price)} y su presupuesto es ${cur ?? p.currency ?? ""} ${fmt(budget)}${over}`.replace(/\s+/g, " ")); criteria++;
  }

  const rooms = v<number>("rooms_min");
  if (rooms && p.bedrooms != null) {
    if (p.bedrooms < rooms) return { ok: false, reasons: [`Necesita ${rooms} dormitorios`], criteria };
    reasons.push(`Dormitorios: necesita ${rooms} y tiene ${p.bedrooms}`);
  }

  return { ok: criteria >= MIN_CRITERIA, reasons, criteria };
}

/** "casa de 3 dormitorios en Salsipuedes, USD 95.000" (para el aviso y para la plantilla). */
export function propertySummary(r: PublicRow): string {
  const f = toFact(r);
  const tipo = (f.tipo ?? "propiedad").toLowerCase();
  const dorm = f.dormitorios ? ` de ${f.dormitorios} dormitorio${f.dormitorios === 1 ? "" : "s"}` : "";
  return `${tipo}${dorm}${f.zona ? ` en ${f.zona}` : ""}${f.precio ? `, ${f.precio}` : ""}`;
}

/** Texto del aviso (dentro de las 24 h sale así; fuera, la plantilla con los mismos datos). */
export function proactiveText(r: PublicRow): string {
  const link = toFact(r).link;
  return `Hola! Te escribimos de Zavala Seppey. Entró una propiedad que coincide con lo que estabas buscando: ${propertySummary(r)}.${link ? ` Podés verla acá: ${link}` : ""}\n\n¿Querés que te contemos más?`;
}

export interface MatcherSummary { properties: number; drafts: number; skippedNoConsent: number }

/**
 * Busca interesados para estas propiedades y deja un borrador por cada uno (si ya había, no repite).
 * Solo propone a quien: no pidió la baja, y (escribió en las últimas 24 h, o aceptó recibir avisos).
 */
export async function runMatcher(db: SupabaseClient, propertyIds: string[], now = Date.now()): Promise<MatcherSummary> {
  const out: MatcherSummary = { properties: 0, drafts: 0, skippedNoConsent: 0 };
  if (!propertyIds.length) return out;
  const { data: props } = await db.from("properties_public").select(PUBLIC_COLUMNS).in("id", propertyIds);
  const { data: leads } = await db.from("lead_profiles")
    .select("*, contact:contacts(id, proactive_opt_out, conversations(id, last_message_at, channel_id))");
  for (const p of (props ?? []) as unknown as PublicRow[]) {
    out.properties++;
    for (const row of leads ?? []) {
      const c = row.contact as { id: string; proactive_opt_out: boolean; conversations: { id: string; last_message_at: string | null }[] } | null;
      if (!c || c.proactive_opt_out) continue;
      const { profile } = profileFromRow(row);
      const m = matchReasons(p, profile);
      if (!m.ok) continue;
      const conv = [...c.conversations].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0];
      if (!conv) continue;
      const inWindow = !!row.last_message_at && now - new Date(row.last_message_at).getTime() < SERVICE_WINDOW_MS;
      const consent = (row.wants_alerts as { value?: boolean } | null)?.value === true;
      if (!inWindow && !consent) { out.skippedNoConsent++; continue; }
      const { data: draft, error } = await db.rpc("save_match", {
        p_property_id: p.id, p_contact_id: c.id, p_conversation_id: conv.id, p_reasons: m.reasons, p_body: proactiveText(p),
      });
      if (error) { console.error("[matcher] no se pudo guardar conv=%s: %s", conv.id, error.message); continue; }
      if (draft) out.drafts++;
    }
  }
  return out;
}

// ───────── Plantilla de Meta para avisos fuera de las 24 h ─────────
// El texto tiene que ser IDÉNTICO al aprobado en Meta (scripts/create-template.ts lo crea desde acá).
export const PROPERTY_TEMPLATE = {
  name: process.env.META_TEMPLATE_PROPERTY ?? "aviso_propiedad",
  language: process.env.META_TEMPLATE_LANG ?? "es_AR",
  category: "MARKETING" as const,
  body: "Hola! Te escribimos de Zavala Seppey. Entró una propiedad que coincide con lo que estabas buscando: {{1}}. Podés verla acá: {{2}}\n\n¿Querés que te contemos más?",
  example: ["casa de 3 dormitorios en Salsipuedes, USD 95.000", "https://inmobiliariazavalaseppey.com.ar/propiedades/"],
  /** Botones de respuesta rápida, en orden, con el payload que vuelve en el webhook. */
  buttons: [{ text: "Sí, quiero más info", payload: "INFO" }, { text: "No quiero recibir más", payload: "OPT_OUT" }],
};
export const OPT_OUT_PAYLOAD = "OPT_OUT";
export const OPT_OUT_REPLY = "Listo, no te vamos a mandar más avisos. Si más adelante buscás algo, escribinos por acá.";

/** Los dos parámetros de la plantilla para una propiedad. */
export function templateParams(r: PublicRow): string[] {
  return [propertySummary(r), toFact(r).link ?? "https://inmobiliariazavalaseppey.com.ar/propiedades/"];
}
export function renderTemplate(params: string[]): string {
  return PROPERTY_TEMPLATE.body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
}

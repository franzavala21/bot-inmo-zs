// Consultas de portales que entran a Tokko (Zonaprop, Mercadolibre, web…): se copian a portal_leads para verlas en el panel.
// No se le escribe a nadie desde acá: un dueño aprueba cada mensaje (plantilla de Meta) en /consultas.
// Privacidad: nunca se loguean nombres, teléfonos ni emails; solo cantidades.
import type { SupabaseClient } from "@supabase/supabase-js";
import { TokkoClient, type TokkoContact } from "./client";
import { firstName } from "../bot/name";

/** Teléfono argentino → formato de WhatsApp 549 + área + número (10 dígitos). null si no se puede saber. */
export function normalizeArPhone(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 11 && d.startsWith("9")) d = d.slice(1);
  if (d.length === 12) {
    // Área de 2 a 4 dígitos seguida de "15" (celular escrito a la antigua): se saca el 15.
    for (const a of [2, 3, 4]) if (d.slice(a, a + 2) === "15") { d = d.slice(0, a) + d.slice(a + 2); break; }
  }
  if (d.length === 9 && d.startsWith("15")) d = "351" + d.slice(2); // "15 1234567" sin área: Córdoba
  if (d.length === 7) d = "351" + d;                                 // número local de Córdoba
  return /^\d{10}$/.test(d) && !d.startsWith("0") ? `549${d}` : null;
}

const NOISE = new Set(["web", "contacto por whatsapp", "consulta", "vio telefono", "mercadolibre", "zonaprop", "proppit", "argenprop", "venta", "alquiler"]);
const TYPE = /^(casas?|departamentos?|deptos?|terrenos?|lotes?|ph|locales?|oficinas?|cocheras?|campos?|galp[oó]n(es)?|quintas?|caba[nñ]as?|terrenos y lotes.*|departamentos - .*)$/i;
const ORIGINS = ["Zonaprop", "Mercadolibre", "Argenprop", "Proppit", "Contacto por Whatsapp", "Web"];
const TYPE_NAME = (t: string) => t.toLowerCase().startsWith("terreno") || t.toLowerCase().startsWith("lote") ? "terreno"
  : t.toLowerCase().startsWith("depart") || t.toLowerCase().startsWith("depto") ? "departamento" : t.toLowerCase().replace(/s$/, "");

/** Etiquetas de Tokko → origen, operación, tipo y zonas. */
export function parseContactTags(tags: TokkoContact["tags"]) {
  const names = (tags ?? []).map((t) => (t.name ?? "").trim()).filter(Boolean);
  const grouped = (tags ?? []).find((t) => t.group_name === "Origen de contacto")?.name ?? null;
  const origin = grouped ?? ORIGINS.find((o) => names.some((n) => n.toLowerCase() === o.toLowerCase())) ?? null;
  const operation = names.some((n) => n.toLowerCase() === "venta") ? "sale" : names.some((n) => n.toLowerCase() === "alquiler") ? "rent" : null;
  const typeTag = names.find((n) => TYPE.test(n));
  const zones = [...new Set(names
    .map((n) => (n.includes("|") ? n.split("|").pop()!.trim() : n))
    .filter((n) => !NOISE.has(n.toLowerCase()) && !TYPE.test(n)))];
  return { origin, operation: operation as "sale" | "rent" | null, property_type: typeTag ? TYPE_NAME(typeTag) : null, zones, tags: names };
}

/** Fila de portal_leads para un contacto de Tokko. */
export function toPortalLead(c: TokkoContact) {
  const raw = c.cellphone || c.phone || c.other_phone || null;
  return {
    tokko_contact_id: c.id, name: c.name?.trim() || null, phone: normalizeArPhone(raw), phone_raw: raw, email: c.email || null,
    tokko_status: c.lead_status ?? null, tokko_created_at: c.created_at ?? new Date().toISOString(), synced_at: new Date().toISOString(),
    ...parseContactTags(c.tags),
  };
}

/** Desde cuántos días atrás se traen consultas la primera vez. */
export const PORTAL_FIRST_SYNC_DAYS = 30;

/**
 * Trae de Tokko los contactos nuevos y los guarda (no pisa el estado: nueva / contactada / descartada).
 * Si el teléfono ya escribió al WhatsApp del bot, lo vincula a ese chat.
 */
export async function syncPortalLeads(db: SupabaseClient, tokkoKey: string, now = new Date()): Promise<{ fetched: number; saved: number }> {
  const { data: last } = await db.from("portal_leads").select("tokko_created_at").order("tokko_created_at", { ascending: false }).limit(1).maybeSingle();
  const since = last ? new Date(new Date(last.tokko_created_at).getTime() - 2 * 86400_000) : new Date(now.getTime() - PORTAL_FIRST_SYNC_DAYS * 86400_000);
  const contacts = (await new TokkoClient(tokkoKey).listContactsSince(since)).filter((c) => !c.deleted_at);
  const rows = contacts.map(toPortalLead);
  // Vincular con chats existentes por teléfono.
  const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))] as string[];
  const { data: known } = phones.length ? await db.from("contacts").select("id, phone, conversations(id)").in("phone", phones) : { data: [] };
  const byPhone = new Map((known ?? []).map((k) => [k.phone as string, k]));
  const withLinks = rows.map((r) => {
    const k = r.phone ? byPhone.get(r.phone) : undefined;
    return { ...r, ...(k ? { contact_id: k.id, conversation_id: (k.conversations as { id: string }[])[0]?.id ?? null } : {}) };
  });
  for (let i = 0; i < withLinks.length; i += 200) {
    const { error } = await db.from("portal_leads").upsert(withLinks.slice(i, i + 200), { onConflict: "tokko_contact_id" });
    if (error) throw new Error(`portal_leads: ${error.message}`);
  }
  return { fetched: contacts.length, saved: withLinks.length };
}

// ───────── Plantilla de Meta para escribirle por su consulta (fuera de toda ventana: nunca nos escribió) ─────────
export const PORTAL_TEMPLATE = {
  name: process.env.META_TEMPLATE_PORTAL ?? "consulta_portal",
  language: process.env.META_TEMPLATE_LANG ?? "es_AR",
  category: "MARKETING" as const,
  body: "Hola {{1}}! Soy Francisco, de Zavala Seppey. Vimos tu consulta en {{2}} por una propiedad en {{3}}. ¿Seguís buscando? Contame qué necesitás y te paso opciones.",
  example: ["Ana", "Zonaprop", "Salsipuedes"],
  buttons: [{ text: "No me interesa", payload: "OPT_OUT" }],
};

const ORIGIN_LABEL: Record<string, string> = { "Contacto por Whatsapp": "WhatsApp", Web: "nuestra web" };
export function portalTemplateParams(l: { name: string | null; origin: string | null; zones: string[] }): string[] {
  return [
    firstName(l.name) ?? "qué tal",
    l.origin ? ORIGIN_LABEL[l.origin] ?? l.origin : "nuestra web",
    l.zones[0] ?? "Sierras Chicas",
  ];
}
export function renderPortalTemplate(params: string[]): string {
  return PORTAL_TEMPLATE.body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
}

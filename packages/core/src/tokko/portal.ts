// Consultas de portales que entran a Tokko (Zonaprop, Mercadolibre, web…): se copian a portal_leads para verlas en el panel.
// No se le escribe a nadie desde acá: un dueño aprueba cada mensaje (plantilla de Meta) en /consultas.
// Privacidad: nunca se loguean nombres, teléfonos ni emails; solo cantidades.
import type { SupabaseClient } from "@supabase/supabase-js";
import { TokkoClient, type TokkoContact } from "./client";
import { firstName } from "../bot/name";
import type { PublicRow } from "../bot/facts";
import { PUBLIC_COLUMNS } from "../retrieval/search";
import type { TemplateSend } from "../transport/meta";

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
  // Ojo: Tokko completa deleted_at con una fecha en TODOS los contactos (también los activos): no sirve para filtrar.
  const contacts = await new TokkoClient(tokkoKey).listContactsSince(since);
  const rows = contacts.map(toPortalLead);
  // Vincular con chats existentes por teléfono.
  const phones = [...new Set(rows.map((r) => r.phone).filter(Boolean))] as string[];
  const { data: known } = phones.length ? await db.from("contacts").select("id, phone, conversations(id)").in("phone", phones) : { data: [] };
  const byPhone = new Map((known ?? []).map((k) => [k.phone as string, k]));
  const withLinks = rows.map((r) => {
    const k = r.phone ? byPhone.get(r.phone) : undefined;
    return { ...r, ...(k ? { contact_id: k.id, conversation_id: (k.conversations as { id: string }[])[0]?.id ?? null } : {}) };
  });
  // Consultas que ya creó el email (sin id de Tokko): si coincide teléfono o email, se les pone el id en vez de duplicar.
  const ids = withLinks.map((r) => r.tokko_contact_id);
  const { data: known2 } = ids.length ? await db.from("portal_leads").select("tokko_contact_id").in("tokko_contact_id", ids) : { data: [] };
  const already = new Set((known2 ?? []).map((k) => Number(k.tokko_contact_id)));
  const { data: fromEmail } = await db.from("portal_leads").select("id, phone, email").is("tokko_contact_id", null);
  const toUpsert: typeof withLinks = [];
  for (const r of withLinks) {
    const twin = !already.has(r.tokko_contact_id)
      ? (fromEmail ?? []).find((e) => (r.phone && e.phone === r.phone) || (r.email && e.email && e.email.toLowerCase() === r.email.toLowerCase()))
      : undefined;
    if (twin) {
      const { error } = await db.from("portal_leads").update({ tokko_contact_id: r.tokko_contact_id, tokko_status: r.tokko_status, synced_at: r.synced_at }).eq("id", twin.id);
      if (error) throw new Error(`portal_leads: ${error.message}`);
      fromEmail!.splice(fromEmail!.indexOf(twin), 1);
    } else toUpsert.push(r);
  }
  for (let i = 0; i < toUpsert.length; i += 200) {
    const { error } = await db.from("portal_leads").upsert(toUpsert.slice(i, i + 200), { onConflict: "tokko_contact_id" });
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

// ───────── Consultas creadas desde el email "Nueva consulta" de Tokko ─────────
export interface InquiryRow { name: string | null; email: string | null; phone: string | null; tags: string[]; received_at: string }

/**
 * Qué hacer con un aviso por email, según las consultas que ya hay de esa persona (código puro):
 * - hay una "nueva" → nada (esa consulta ya muestra la propiedad);
 * - todas se decidieron (contactada/descartada) ANTES de este aviso → consulta nueva (volvió a consultar);
 * - alguna se decidió después del aviso → nada (ya se atendió);
 * - no hay ninguna → consulta nueva.
 */
export function inquiryCreatesLead(received: string, existing: { status: string; decided_at: string | null }[]): boolean {
  if (existing.some((l) => l.status === "new")) return false;
  return existing.every((l) => !!l.decided_at && l.decided_at < received);
}

export async function leadsFromInquiries(db: SupabaseClient, inqs: InquiryRow[]): Promise<number> {
  let created = 0;
  for (const q of inqs) {
    if (!q.phone && !q.email) continue;
    const [byPhone, byEmail] = await Promise.all([
      q.phone ? db.from("portal_leads").select("status, decided_at").eq("phone", q.phone) : Promise.resolve({ data: [] }),
      q.email ? db.from("portal_leads").select("status, decided_at").ilike("email", q.email) : Promise.resolve({ data: [] }),
    ]);
    const existing = [...(byPhone.data ?? []), ...(byEmail.data ?? [])] as { status: string; decided_at: string | null }[];
    if (!inquiryCreatesLead(q.received_at, existing)) continue;
    const t = parseContactTags(q.tags.map((name) => ({ name })));
    const { data: contact } = q.phone ? await db.from("contacts").select("id, conversations(id)").eq("phone", q.phone).maybeSingle() : { data: null };
    const { error } = await db.from("portal_leads").insert({
      tokko_contact_id: null, source: "email", name: q.name, phone: q.phone, phone_raw: q.phone, email: q.email,
      tokko_status: null, tokko_created_at: q.received_at, ...t,
      ...(contact ? { contact_id: contact.id, conversation_id: (contact.conversations as { id: string }[])[0]?.id ?? null } : {}),
    });
    if (error) { console.error("[email] no se pudo crear la consulta: %s", error.code); continue; }
    created++;
  }
  return created;
}

// ───────── Con la propiedad consultada (del email de Tokko): plantilla con el link ─────────
export const PORTAL_PROPERTY_TEMPLATE = {
  name: process.env.META_TEMPLATE_PORTAL_PROP ?? "consulta_portal_propiedad",
  language: process.env.META_TEMPLATE_LANG ?? "es_AR",
  category: "MARKETING" as const,
  body: "Hola {{1}}! Soy Francisco, de Zavala Seppey. Vimos tu consulta en {{2}} por {{3}}: {{4}}\n\n¿Seguís interesado? Contame y te ayudo.",
  example: ["Ana", "Zonaprop", "la casa de 3 dormitorios en Salsipuedes, USD 95.000", "https://inmobiliariazavalaseppey.com.ar/propiedad/casa-3-dormitorios-en-venta-salsipuedes-7276514/"],
  buttons: [{ text: "No me interesa", payload: "OPT_OUT" }],
};

const ARTICLE: [RegExp, string][] = [[/^(casa|caba[nñ]a|oficina|quinta|cochera)/i, "la"], [/^(terreno|lote|departamento|depto|ph|local|galp|campo|d[uú]plex|chalet)/i, "el"]];
/** "la casa de 3 dormitorios en Salsipuedes, USD 95.000" (con artículo según el tipo). */
export function propertyPhrase(p: { property_type: string | null; bedrooms: number | null; zone: string | null; price: number | null; currency: string | null }): string {
  const tipo = (p.property_type ?? "propiedad").toLowerCase();
  const art = ARTICLE.find(([re]) => re.test(tipo))?.[1] ?? "la";
  const dorm = p.bedrooms && p.bedrooms > 0 ? ` de ${p.bedrooms} dormitorio${p.bedrooms === 1 ? "" : "s"}` : "";
  const price = p.price && p.price > 0 ? `, ${p.currency ?? ""} ${new Intl.NumberFormat("es-AR").format(p.price)}`.replace(/ +/g, " ") : "";
  return `${art} ${tipo === "ph" ? "PH" : tipo}${dorm}${p.zone ? ` en ${p.zone}` : ""}${price}`;
}
export function portalPropertyParams(l: { name: string | null; origin: string | null }, p: Parameters<typeof propertyPhrase>[0], link: string): string[] {
  const [name, origin] = portalTemplateParams({ name: l.name, origin: l.origin, zones: [] });
  return [name, origin, propertyPhrase(p), link];
}
export function renderPortalPropertyTemplate(params: string[]): string {
  return PORTAL_PROPERTY_TEMPLATE.body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
}

/** Link para abrir el chat en el WhatsApp del dueño con el mensaje ya escrito (lo manda él, desde su teléfono). */
export function waMeLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

/**
 * Mensaje para escribirle a una consulta de portal. Si llegó el email de Tokko con la propiedad (y la ficha tiene link),
 * va la plantilla con la propiedad y su link, para que sepa qué consultó; si no, la genérica.
 * Lee propiedades solo de properties_public.
 */
export async function portalMessageFor(
  db: SupabaseClient,
  l: { name: string | null; origin: string | null; zones: string[] | null; phone: string | null; email: string | null },
): Promise<{ template: TemplateSend; body: string; codes: string[]; prop: PublicRow | null }> {
  const pick = "property_codes, received_at";
  const [byPhone, byEmail] = await Promise.all([
    l.phone ? db.from("portal_inquiries").select(pick).eq("phone", l.phone).order("received_at", { ascending: false }).limit(1).maybeSingle() : null,
    l.email ? db.from("portal_inquiries").select(pick).eq("email", l.email.toLowerCase()).order("received_at", { ascending: false }).limit(1).maybeSingle() : null,
  ]);
  const found = [byPhone?.data, byEmail?.data].filter(Boolean) as { received_at: string; property_codes: string[] }[];
  const codes = found.sort((a, b) => b.received_at.localeCompare(a.received_at))[0]?.property_codes ?? [];
  const { data: row } = codes.length
    ? await db.from("properties_public").select(PUBLIC_COLUMNS).in("reference_code", codes).limit(1).maybeSingle()
    : { data: null };
  const prop = row as unknown as PublicRow | null;
  const link = prop ? prop.web_url || prop.public_url : null;
  if (prop && link) {
    const params = portalPropertyParams(l, prop, link);
    const T = PORTAL_PROPERTY_TEMPLATE;
    return { template: { name: T.name, language: T.language, params, buttons: T.buttons.map((b) => b.payload) },
      body: renderPortalPropertyTemplate(params), codes: prop.reference_code ? [prop.reference_code] : [], prop };
  }
  const params = portalTemplateParams({ name: l.name, origin: l.origin, zones: prop?.zone ? [prop.zone] : l.zones ?? [] });
  const T = PORTAL_TEMPLATE;
  return { template: { name: T.name, language: T.language, params, buttons: T.buttons.map((b) => b.payload) },
    body: renderPortalTemplate(params), codes: prop?.reference_code ? [prop.reference_code] : [], prop };
}

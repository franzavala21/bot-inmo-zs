// Seguimientos (código, sin modelo): retomar a quien dejó de responder. Solo arma borradores; un dueño aprueba de a uno.
// 1er seguimiento: 20 h después del último mensaje del cliente (texto, dentro de las 24 h de WhatsApp).
// 2do seguimiento: a los 3 días (hasta 7), con plantilla de Meta, solo a quien aceptó recibir avisos.
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientFirstName } from "../bot/name";
import { profileFromRow } from "./run";
import type { Profile } from "./profile";

const H = 3600_000;
export const FOLLOW_UP_1 = { from: 20 * H, to: 23.5 * H };   // dejar margen para aprobarlo antes de las 24 h
export const FOLLOW_UP_2 = { from: 72 * H, to: 7 * 24 * H };
export type FollowUpKind = "follow_up_1" | "follow_up_2";

/** ¿Corresponde un seguimiento para este chat ahora? */
export function followUpStage(c: {
  lastClientAt: number | null; lastAuthor: string | null; needsAttention: boolean; optOut: boolean; wantsAlerts: boolean;
}, now: number): FollowUpKind | null {
  if (!c.lastClientAt || c.optOut || c.needsAttention) return null;
  if (c.lastAuthor === "client" || c.lastAuthor === "system" || !c.lastAuthor) return null; // falta contestarle, no retomarlo
  const age = now - c.lastClientAt;
  if (age >= FOLLOW_UP_1.from && age < FOLLOW_UP_1.to) return "follow_up_1";
  if (age >= FOLLOW_UP_2.from && age < FOLLOW_UP_2.to && c.wantsAlerts) return "follow_up_2";
  return null;
}

/** "casa en Salsipuedes" / "una propiedad en Sierras Chicas" (de la ficha). */
export function searchPhrase(p: Profile): string {
  const type = (p.property_type?.value as string | undefined)?.toLowerCase();
  const zones = (p.zones?.value as string[] | undefined) ?? [];
  return `${type ?? "una propiedad"} en ${zones[0] ?? "Sierras Chicas"}`;
}

const NOUN: Record<string, [string, string]> = {
  casa: ["la casa", "las casas"], terreno: ["el terreno", "los terrenos"], lote: ["el lote", "los lotes"],
  departamento: ["el departamento", "los departamentos"], ph: ["el PH", "los PH"], local: ["el local", "los locales"],
  oficina: ["la oficina", "las oficinas"], "cabaña": ["la cabaña", "las cabañas"], cochera: ["la cochera", "las cocheras"],
};
function nounPhrase(tipo: string, plural: boolean): string {
  const n = NOUN[tipo] ?? ["la propiedad", "las propiedades"];
  return plural ? n[1] : n[0];
}

/** Texto del 1er seguimiento: retoma lo último (propiedades mostradas o lo que busca). */
export function followUpText(name: string | null, shown: { tipo: string | null }[], p: Profile): string {
  const hola = `Hola${name ? ` ${name}` : ""}!`;
  if (shown.length) {
    const tipos = [...new Set(shown.map((s) => (s.tipo ?? "propiedad").toLowerCase()))];
    const what = tipos.length > 1 ? (shown.length === 1 ? "la propiedad" : "las propiedades") : nounPhrase(tipos[0], shown.length > 1);
    return `${hola} ¿Pudiste ver ${what} que te pasé? Contame si alguna te interesa o si preferís que te busque otras opciones.`;
  }
  return `${hola} ¿Seguís buscando ${searchPhrase(p)}? Contame qué necesitás y te paso opciones.`;
}

// ───────── Plantilla del 2do seguimiento ─────────
export const FOLLOW_UP_TEMPLATE = {
  name: process.env.META_TEMPLATE_FOLLOWUP ?? "seguimiento_busqueda",
  language: process.env.META_TEMPLATE_LANG ?? "es_AR",
  category: "MARKETING" as const,
  body: "Hola {{1}}! Soy Francisco, de Zavala Seppey. ¿Seguís buscando {{2}}? Si querés, te paso opciones nuevas.",
  example: ["Ana", "casa en Salsipuedes"],
  buttons: [{ text: "No me interesa", payload: "OPT_OUT" }],
};
export function followUpTemplateParams(name: string | null, p: Profile): string[] {
  return [name ?? "qué tal", searchPhrase(p)];
}
export function renderFollowUpTemplate(params: string[]): string {
  return FOLLOW_UP_TEMPLATE.body.replace(/\{\{(\d+)\}\}/g, (_, i) => params[Number(i) - 1] ?? "");
}

/**
 * Revisa los chats y deja borradores de seguimiento donde corresponda. Barato: se puede llamar seguido
 * (con cada mensaje que entra, al abrir el panel y en el cron). Nunca envía.
 */
export async function runFollowUps(db: SupabaseClient, now = Date.now()): Promise<{ drafted: number; discarded: number }> {
  const { data: disc } = await db.rpc("discard_answered_follow_ups");
  const since = new Date(now - FOLLOW_UP_2.to).toISOString();
  const { data: convs } = await db.from("conversations")
    .select("id, needs_attention, contact_id, contact:contacts(name, display_name, proactive_opt_out), messages(id, author, created_at)")
    .gte("last_message_at", since).order("created_at", { referencedTable: "messages", ascending: false }).limit(30, { referencedTable: "messages" }).limit(300);
  let drafted = 0;
  for (const c of convs ?? []) {
    const msgs = (c.messages ?? []) as { id: string; author: string; created_at: string }[];
    const lastClient = msgs.find((m) => m.author === "client");
    const contact = c.contact as unknown as { name: string | null; display_name: string | null; proactive_opt_out: boolean } | null;
    // Filtro barato antes de ir a la ficha: ¿está en alguna franja (suponiendo que aceptó avisos)?
    if (!followUpStage({ lastClientAt: lastClient ? Date.parse(lastClient.created_at) : null, lastAuthor: msgs[0]?.author ?? null,
      needsAttention: c.needs_attention, optOut: !!contact?.proactive_opt_out, wantsAlerts: true }, now)) continue;
    const { data: lead } = await db.from("lead_profiles").select("*").eq("contact_id", c.contact_id).maybeSingle();
    const { profile } = profileFromRow(lead);
    const stage = followUpStage({
      lastClientAt: lastClient ? Date.parse(lastClient.created_at) : null, lastAuthor: msgs[0]?.author ?? null,
      needsAttention: c.needs_attention, optOut: !!contact?.proactive_opt_out,
      wantsAlerts: (lead?.wants_alerts as { value?: boolean } | null)?.value === true,
    }, now);
    if (!stage || !lastClient) continue;
    const name = clientFirstName({ name: contact?.name, profileName: (profile.name?.value as string | undefined) ?? null, displayName: contact?.display_name });
    let body: string;
    if (stage === "follow_up_1") {
      const { data: sent } = await db.from("audit_log").select("details").eq("conversation_id", c.id).in("event", ["sent", "sent_handoff"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const codes = ((sent?.details as { property_codes?: string[] } | null)?.property_codes ?? []).slice(0, 3);
      const { data: shown } = codes.length ? await db.from("properties_public").select("property_type").in("reference_code", codes) : { data: [] };
      body = followUpText(name, (shown ?? []).map((s) => ({ tipo: s.property_type as string | null })), profile);
    } else {
      body = renderFollowUpTemplate(followUpTemplateParams(name, profile));
    }
    const { data: id, error } = await db.rpc("save_follow_up", { p_conversation_id: c.id, p_kind: stage, p_anchor: lastClient.id, p_body: body });
    if (error) { console.error("[seguimiento] conv=%s: %s", c.id, error.message); continue; }
    if (id) drafted++;
  }
  return { drafted, discarded: Number(disc ?? 0) };
}

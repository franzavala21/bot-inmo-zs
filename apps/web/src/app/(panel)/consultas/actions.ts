"use server";
import { revalidatePath } from "next/cache";
import {
  adminClient, drainForConversation, MetaClient, metaConfigFromEnv, PORTAL_TEMPLATE, portalTemplateParams,
  renderPortalTemplate, syncPortalLeads,
} from "@inmo/core";

import { requireOwner } from "@/lib/supabase/server";

const CHANNEL = "ventas";

/**
 * Última consulta por email de Tokko de esta persona (por teléfono o email): trae la propiedad.
 * NO exportar: en un archivo "use server" todo lo exportado es una acción que se puede llamar desde afuera.
 */
async function inquiryFor(db: ReturnType<typeof adminClient>, phone: string | null, email: string | null) {
  const pick = "property_codes, property_title, message, received_at";
  const [byPhone, byEmail] = await Promise.all([
    phone ? db.from("portal_inquiries").select(pick).eq("phone", phone).order("received_at", { ascending: false }).limit(1).maybeSingle() : null,
    email ? db.from("portal_inquiries").select(pick).eq("email", email.toLowerCase()).order("received_at", { ascending: false }).limit(1).maybeSingle() : null,
  ]);
  const found = [byPhone?.data, byEmail?.data].filter(Boolean) as { received_at: string; property_codes: string[] }[];
  return found.sort((a, b) => b.received_at.localeCompare(a.received_at))[0] ?? null;
}

/** Trae de Tokko las consultas nuevas (no le escribe a nadie). */
export async function refreshPortalLeads(): Promise<{ ok: boolean; fetched?: number; error?: string }> {
  if (!(await requireOwner())) return { ok: false, error: "No autorizado" };
  try {
    const r = await syncPortalLeads(adminClient(), process.env.TOKKO_API_KEY!);
    revalidatePath("/consultas");
    return { ok: true, fetched: r.fetched };
  } catch (e) {
    console.error("[consultas] no se pudo sincronizar: %s", (e as Error).message.slice(0, 120));
    return { ok: false, error: "No se pudo traer de Tokko" };
  }
}

/** Un dueño aprueba escribirle a UNA consulta: sale la plantilla de Meta desde el número del bot. */
export async function contactPortalLead(leadId: string): Promise<{ ok: boolean; error?: string; conversationId?: string; sent?: boolean }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const db = adminClient();
  const { data: l } = await db.from("portal_leads").select("name, origin, zones, operation, status, phone, email").eq("id", leadId).maybeSingle();
  if (!l || l.status !== "new") return { ok: false, error: "Esta consulta ya no está pendiente" };
  if (!l.phone) return { ok: false, error: "No tiene un teléfono válido" };
  if (l.operation === "rent") return { ok: false, error: "Es de alquiler: la atiende otra persona" };

  // Si llegó el email de Tokko, se sabe la propiedad: la zona sale de ahí y el bot queda sabiendo de qué ficha hablan.
  const inq = await inquiryFor(db, l.phone, l.email);
  const codes = (inq?.property_codes ?? []) as string[];
  const { data: prop } = codes.length
    ? await db.from("properties_public").select("reference_code, zone").in("reference_code", codes).limit(1).maybeSingle()
    : { data: null };
  const params = portalTemplateParams({ name: l.name, origin: l.origin, zones: prop?.zone ? [prop.zone] : l.zones ?? [] });
  const template = { name: PORTAL_TEMPLATE.name, language: PORTAL_TEMPLATE.language, params, buttons: PORTAL_TEMPLATE.buttons.map((b) => b.payload) };
  const { data, error } = await db.rpc("contact_portal_lead", {
    p_lead_id: leadId, p_user: user.id, p_channel_slug: CHANNEL, p_body: renderPortalTemplate(params), p_template: template,
    p_property_codes: prop ? [prop.reference_code] : [],
  });
  if (error) {
    const m = error.message;
    return { ok: false, error: m.includes("pendiente") ? "Esta consulta ya no está pendiente" : m.includes("no recibir") ? "Pidió no recibir mensajes" : "No se pudo encolar" };
  }
  const conversationId = (data as { conversation_id: string }).conversation_id;
  const cfg = metaConfigFromEnv();
  const r = await drainForConversation(db, cfg ? new MetaClient(cfg) : null, conversationId).catch(() => null);
  revalidatePath("/consultas");
  return { ok: true, conversationId, sent: !!r && r.sent > 0 };
}

export async function dismissPortalLead(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const { error } = await adminClient().rpc("dismiss_portal_lead", { p_lead_id: leadId, p_user: user.id });
  if (error) return { ok: false, error: "No se pudo descartar" };
  revalidatePath("/consultas");
  return { ok: true };
}

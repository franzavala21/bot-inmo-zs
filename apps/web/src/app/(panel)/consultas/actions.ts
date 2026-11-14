"use server";
import { revalidatePath } from "next/cache";
import {
  adminClient, drainForConversation, MetaClient, metaConfigFromEnv, PORTAL_TEMPLATE, portalTemplateParams,
  renderPortalTemplate, syncPortalLeads,
} from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

const CHANNEL = "ventas";

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
  const { data: l } = await db.from("portal_leads").select("name, origin, zones, operation, status, phone").eq("id", leadId).maybeSingle();
  if (!l || l.status !== "new") return { ok: false, error: "Esta consulta ya no está pendiente" };
  if (!l.phone) return { ok: false, error: "No tiene un teléfono válido" };
  if (l.operation === "rent") return { ok: false, error: "Es de alquiler: la atiende otra persona" };

  const params = portalTemplateParams({ name: l.name, origin: l.origin, zones: l.zones ?? [] });
  const template = { name: PORTAL_TEMPLATE.name, language: PORTAL_TEMPLATE.language, params, buttons: PORTAL_TEMPLATE.buttons.map((b) => b.payload) };
  const { data, error } = await db.rpc("contact_portal_lead", {
    p_lead_id: leadId, p_user: user.id, p_channel_slug: CHANNEL, p_body: renderPortalTemplate(params), p_template: template,
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

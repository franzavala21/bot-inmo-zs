"use server";
import { revalidatePath } from "next/cache";
import {
  adminClient, drainForConversation, lastClientMessageAt, MetaClient, metaConfigFromEnv, PROPERTY_TEMPLATE, PUBLIC_COLUMNS,
  renderTemplate, SERVICE_WINDOW_MS, TEMPLATE_STATUS_LABEL, templateParams, templateReady, type PublicRow,
} from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string; sent?: boolean };

/**
 * Un dueño aprueba UN aviso. Dentro de las 24 h sale como texto (se puede editar);
 * fuera, como plantilla aprobada por Meta, y solo si el cliente aceptó recibir avisos.
 */
export async function approveDraft(draftId: string, editedBody?: string): Promise<Result> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const db = adminClient();
  const { data: d } = await db.from("outbound_drafts").select("id, status, body, contact_id, conversation_id, property_id").eq("id", draftId).maybeSingle();
  if (!d || d.status !== "pending") return { ok: false, error: "Este aviso ya no está pendiente" };
  const { data: prop } = await db.from("properties_public").select(PUBLIC_COLUMNS).eq("id", d.property_id).maybeSingle();
  if (!prop) return { ok: false, error: "La propiedad ya no está disponible: descartá el aviso" };

  const last = await lastClientMessageAt(db, d.conversation_id);
  const inWindow = !!last && Date.now() - last.getTime() < SERVICE_WINDOW_MS;
  let body = (editedBody ?? d.body).trim();
  let template = null;
  if (!inWindow) {
    const { data: lead } = await db.from("lead_profiles").select("wants_alerts").eq("contact_id", d.contact_id).maybeSingle();
    if ((lead?.wants_alerts as { value?: boolean } | null)?.value !== true) {
      return { ok: false, error: "Pasaron más de 24 h y el cliente no aceptó recibir avisos: no se le puede escribir" };
    }
    const cfg0 = metaConfigFromEnv();
    const ready = await templateReady(cfg0 ? new MetaClient(cfg0) : null, PROPERTY_TEMPLATE.name, PROPERTY_TEMPLATE.language);
    if (!ready.ok) return { ok: false, error: `La plantilla está ${TEMPLATE_STATUS_LABEL[ready.status] ?? ready.status}: por ahora solo salen avisos como texto (dentro de las 24 h)` };
    const params = templateParams(prop as unknown as PublicRow);
    template = { name: PROPERTY_TEMPLATE.name, language: PROPERTY_TEMPLATE.language, params, buttons: PROPERTY_TEMPLATE.buttons.map((b) => b.payload) };
    body = renderTemplate(params);
  }
  const { error } = await db.rpc("approve_draft", {
    p_draft_id: draftId, p_user: user.id, p_body: body, p_template: template,
    p_property_codes: [(prop as { reference_code: string | null }).reference_code].filter(Boolean),
  });
  if (error) return { ok: false, error: error.message.includes("no está pendiente") ? "Este aviso ya no está pendiente" : error.message.includes("pidió no recibir") ? "El cliente pidió no recibir avisos" : "No se pudo aprobar" };

  // Sale en el momento (canal de Meta). Si falla, queda marcado en el chat con "Reintentar".
  const cfg = metaConfigFromEnv();
  const r = await drainForConversation(db, cfg ? new MetaClient(cfg) : null, d.conversation_id).catch(() => null);
  revalidatePath("/avisos");
  revalidatePath(`/bandeja/${d.conversation_id}`);
  return { ok: true, sent: !!r && r.sent > 0 };
}

export async function discardDraft(draftId: string): Promise<Result> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const { error } = await adminClient().rpc("discard_draft", { p_draft_id: draftId, p_user: user.id });
  if (error) return { ok: false, error: "No se pudo descartar" };
  revalidatePath("/avisos");
  return { ok: true };
}

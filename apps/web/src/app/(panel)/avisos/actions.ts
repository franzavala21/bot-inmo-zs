"use server";
import { revalidatePath } from "next/cache";
import {
  adminClient, clientFirstName, drainForConversation, FOLLOW_UP_TEMPLATE, followUpTemplateParams, lastClientMessageAt, MetaClient,
  metaConfigFromEnv, profileFromRow, PROPERTY_TEMPLATE, PUBLIC_COLUMNS, renderFollowUpTemplate, renderTemplate, SERVICE_WINDOW_MS,
  TEMPLATE_STATUS_LABEL, templateParams, templateReady, type PublicRow, type TemplateSend,
} from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string; sent?: boolean };
type Db = ReturnType<typeof adminClient>;

async function wantsAlerts(db: Db, contactId: string): Promise<boolean> {
  const { data } = await db.from("lead_profiles").select("wants_alerts").eq("contact_id", contactId).maybeSingle();
  return (data?.wants_alerts as { value?: boolean } | null)?.value === true;
}
async function ready(name: string, language: string): Promise<string | null> {
  const cfg = metaConfigFromEnv();
  const r = await templateReady(cfg ? new MetaClient(cfg) : null, name, language);
  return r.ok ? null : `La plantilla está ${TEMPLATE_STATUS_LABEL[r.status] ?? r.status}: todavía no se puede enviar`;
}

/**
 * Un dueño aprueba UN borrador (aviso de propiedad o seguimiento).
 * Dentro de las 24 h sale como texto (se puede editar); fuera, solo con plantilla aprobada y a quien aceptó avisos.
 */
export async function approveDraft(draftId: string, editedBody?: string): Promise<Result> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const db = adminClient();
  const { data: d } = await db.from("outbound_drafts").select("id, status, kind, body, contact_id, conversation_id, property_id").eq("id", draftId).maybeSingle();
  if (!d || d.status !== "pending") return { ok: false, error: "Este borrador ya no está pendiente" };

  const last = await lastClientMessageAt(db, d.conversation_id);
  const inWindow = !!last && Date.now() - last.getTime() < SERVICE_WINDOW_MS;
  let body = (editedBody ?? d.body).trim();
  let template: TemplateSend | null = null;
  let codes: string[] = [];

  if (d.kind === "follow_up_1") {
    if (!inWindow) return { ok: false, error: "Pasaron las 24 h: este seguimiento ya no sale como texto. Descartalo (a los 3 días aparece el de plantilla, si aceptó avisos)." };
  } else if (d.kind === "follow_up_2") {
    if (!inWindow) {
      if (!(await wantsAlerts(db, d.contact_id))) return { ok: false, error: "No aceptó recibir avisos: no se le puede escribir" };
      const err = await ready(FOLLOW_UP_TEMPLATE.name, FOLLOW_UP_TEMPLATE.language);
      if (err) return { ok: false, error: err };
      const [{ data: lead }, { data: contact }] = await Promise.all([
        db.from("lead_profiles").select("*").eq("contact_id", d.contact_id).maybeSingle(),
        db.from("contacts").select("name, display_name").eq("id", d.contact_id).maybeSingle(),
      ]);
      const { profile } = profileFromRow(lead);
      const name = clientFirstName({ name: contact?.name, profileName: (profile.name?.value as string | undefined) ?? null, displayName: contact?.display_name });
      const params = followUpTemplateParams(name, profile);
      template = { name: FOLLOW_UP_TEMPLATE.name, language: FOLLOW_UP_TEMPLATE.language, params, buttons: FOLLOW_UP_TEMPLATE.buttons.map((b) => b.payload) };
      body = renderFollowUpTemplate(params);
    }
  } else {
    // Aviso de propiedad nueva (matcher).
    const { data: prop } = await db.from("properties_public").select(PUBLIC_COLUMNS).eq("id", d.property_id).maybeSingle();
    if (!prop) return { ok: false, error: "La propiedad ya no está disponible: descartá el aviso" };
    codes = [(prop as { reference_code: string | null }).reference_code].filter(Boolean) as string[];
    if (!inWindow) {
      if (!(await wantsAlerts(db, d.contact_id))) return { ok: false, error: "Pasaron más de 24 h y el cliente no aceptó recibir avisos: no se le puede escribir" };
      const err = await ready(PROPERTY_TEMPLATE.name, PROPERTY_TEMPLATE.language);
      if (err) return { ok: false, error: `${err}. Por ahora solo salen avisos como texto (dentro de las 24 h).` };
      const params = templateParams(prop as unknown as PublicRow);
      template = { name: PROPERTY_TEMPLATE.name, language: PROPERTY_TEMPLATE.language, params, buttons: PROPERTY_TEMPLATE.buttons.map((b) => b.payload) };
      body = renderTemplate(params);
    }
  }

  const { error } = await db.rpc("approve_draft", { p_draft_id: draftId, p_user: user.id, p_body: body, p_template: template, p_property_codes: codes });
  if (error) return { ok: false, error: error.message.includes("no está pendiente") ? "Este borrador ya no está pendiente" : error.message.includes("pidió no recibir") ? "El cliente pidió no recibir avisos" : "No se pudo aprobar" };

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

"use server";
import { revalidatePath } from "next/cache";
import { adminClient, drainForConversation, lastClientMessageAt, MetaClient, metaConfigFromEnv, PORTAL_TEMPLATE, portalMessageFor, SERVICE_WINDOW_MS, TEMPLATE_STATUS_LABEL, templateReady, type TemplateSend } from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

const MAX_LEN = 4000;

/** Respuesta de un dueño. human_reply encola, anota en audit_log y pasa el chat a humano, todo en una transacción. */
export async function sendReply(conversationId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const text = body.trim();
  if (!text) return { ok: false, error: "El mensaje está vacío" };
  if (text.length > MAX_LEN) return { ok: false, error: `Máximo ${MAX_LEN} caracteres` };
  const db = adminClient();
  const meta = await isMetaConversation(conversationId);
  if (meta) {
    const last = await lastClientMessageAt(db, conversationId);
    if (!last || Date.now() - last.getTime() > SERVICE_WINDOW_MS) {
      return { ok: false, error: "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo deja mandar plantillas aprobadas por Meta (todavía no están armadas)." };
    }
  }
  const { data: outId, error } = await db.rpc("human_reply", { p_conversation_id: conversationId, p_body: text, p_user: user.id });
  if (error) {
    console.error("[bandeja] no se pudo encolar respuesta conv=%s", conversationId, error.code);
    return { ok: false, error: "No se pudo enviar. Probá de nuevo." };
  }
  const result = meta ? await sendNow(conversationId, outId as string) : { ok: true };
  revalidatePath(`/bandeja/${conversationId}`);
  revalidatePath("/bandeja");
  return result;
}

async function isMetaConversation(conversationId: string): Promise<boolean> {
  const { data } = await adminClient().from("conversations").select("channel:channels(transport)").eq("id", conversationId).maybeSingle();
  return (data?.channel as unknown as { transport: string } | null)?.transport === "meta";
}

/** Canales de Meta: no hay worker, se envía en el momento y se informa si no salió. */
async function sendNow(conversationId: string, outboundId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = metaConfigFromEnv();
  const db = adminClient();
  try {
    await drainForConversation(db, cfg ? new MetaClient(cfg) : null, conversationId);
  } catch (e) {
    console.error("[bandeja] envío falló conv=%s: %s", conversationId, (e as Error).message.slice(0, 160));
  }
  const { data } = await db.from("outbound_messages").select("status, error").eq("id", outboundId).maybeSingle();
  if (data?.status === "failed") return { ok: false, error: `No salió: ${data.error ?? "error de WhatsApp"}` };
  if (data?.status !== "sent") return { ok: false, error: "Quedó en cola: revisá en unos segundos si salió." };
  return { ok: true };
}

/** Reintento de un envío fallido (un dueño, de a uno). */
export async function retryOutbound(conversationId: string, outboundId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const db = adminClient();
  const { data: o } = await db.from("outbound_messages").select("template").eq("id", outboundId).maybeSingle();
  let t = o?.template as TemplateSend | null;
  // Consulta de portal que salió sin la propiedad: si ahora se sabe cuál consultó, se rearma con la propiedad y su link.
  let rebuilt: Awaited<ReturnType<typeof portalMessageFor>> | null = null;
  if (t?.name === PORTAL_TEMPLATE.name) {
    const { data: l } = await db.from("portal_leads").select("name, origin, zones, phone, email")
      .eq("conversation_id", conversationId).order("decided_at", { ascending: false }).limit(1).maybeSingle();
    if (l) {
      const m = await portalMessageFor(db, l);
      if (m.template.name !== t.name) { rebuilt = m; t = m.template; }
    }
  }
  // Con plantilla: si Meta todavía no la aprobó, avisar en vez de volver a fallar (error 132001).
  if (t?.name) {
    const cfg = metaConfigFromEnv();
    const r = await templateReady(cfg ? new MetaClient(cfg) : null, t.name, t.language);
    if (!r.ok) return { ok: false, error: `La plantilla «${t.name}» está ${TEMPLATE_STATUS_LABEL[r.status] ?? r.status}: reintentalo cuando Meta la apruebe` };
  }
  const { error } = rebuilt
    ? await db.rpc("retry_outbound_rebuilt", { p_outbound_id: outboundId, p_user: user.id, p_body: rebuilt.body, p_template: rebuilt.template, p_property_codes: rebuilt.codes })
    : await db.rpc("retry_outbound", { p_outbound_id: outboundId, p_user: user.id });
  if (error) return { ok: false, error: "No se pudo reintentar" };
  const result = (await isMetaConversation(conversationId)) ? await sendNow(conversationId, outboundId) : { ok: true };
  revalidatePath(`/bandeja/${conversationId}`);
  return result;
}

export async function setMode(conversationId: string, mode: "ai" | "human") {
  const user = await requireOwner();
  if (!user) throw new Error("No autorizado");
  const { error } = await adminClient().rpc("set_conversation_mode", { p_conversation_id: conversationId, p_mode: mode, p_user: user.id });
  if (error) throw new Error("No se pudo cambiar el modo");
  revalidatePath(`/bandeja/${conversationId}`);
  revalidatePath("/bandeja");
}

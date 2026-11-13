// Entrada y salida de un canal de Meta, desde la web (Vercel). Reemplaza al worker para estos canales.
// Privacidad: los logs llevan solo ids, nunca teléfono ni texto.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MetaApiError, type MetaClient, type MetaInbound, type TemplateSend } from "./meta";

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
/** WhatsApp solo deja mandar texto libre hasta 24 h después del último mensaje del cliente. */
export const SERVICE_WINDOW_MS = 24 * 3600_000;
export const WINDOW_CLOSED_ERROR = "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite plantillas aprobadas";

const EXT: Record<string, string> = {
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

export interface MetaChannel { id: string; slug: string; meta_phone_number_id: string }

/** Canal que corresponde al número de Meta del webhook. */
export async function channelByPhoneNumberId(db: SupabaseClient, phoneNumberId: string): Promise<MetaChannel | null> {
  const { data } = await db.from("channels").select("id, slug, meta_phone_number_id")
    .eq("meta_phone_number_id", phoneNumberId).eq("transport", "meta").eq("active", true).maybeSingle();
  return (data as MetaChannel | null) ?? null;
}

/** Baja el audio o la imagen y lo guarda en el bucket privado "media". Devuelve la ruta o null. */
export async function storeMetaMedia(db: SupabaseClient, client: MetaClient, slug: string, m: MetaInbound): Promise<string | null> {
  if (!m.mediaId) return null;
  try {
    const file = await client.downloadMedia(m.mediaId, MAX_MEDIA_BYTES);
    if (!file) return null;
    const mime = file.mime.split(";")[0].trim();
    const now = new Date();
    const safeId = m.waMessageId.replace(/[^A-Za-z0-9_-]/g, "").slice(-80);
    const path = `wa/${slug}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${safeId}.${EXT[mime] ?? "bin"}`;
    const { error } = await db.storage.from("media").upload(path, file.data, { contentType: mime, upsert: true });
    if (error) throw error;
    return path;
  } catch (e) {
    console.warn("[meta] no se pudo guardar un archivo: %s", (e as Error).message.slice(0, 120));
    return null;
  }
}

/** Guarda un mensaje del webhook (idempotente por wa_message_id). */
export async function ingestMetaInbound(db: SupabaseClient, client: MetaClient, ch: MetaChannel, m: MetaInbound) {
  const mediaPath = await storeMetaMedia(db, client, ch.slug, m);
  const { data, error } = await db.rpc("ingest_inbound", {
    p_channel_slug: ch.slug, p_wa_message_id: m.waMessageId, p_phone: m.phone, p_wa_jid: `${m.phone}@s.whatsapp.net`,
    p_display_name: m.displayName, p_from_me: m.fromMe, p_kind: m.kind, p_body: m.body, p_media_path: mediaPath,
    p_sent_at: m.sentAt.toISOString(),
  });
  if (error) throw new Error(`ingest_inbound: ${error.code ?? ""} ${error.message}`);
  return data as { conversation_id: string; message_id: string | null; duplicate: boolean };
}

type Outbound = { id: string; conversation_id: string; to_phone: string; body: string; attempts: number; template?: TemplateSend | null };

export async function lastClientMessageAt(db: SupabaseClient, conversationId: string): Promise<Date | null> {
  const { data } = await db.from("messages").select("created_at").eq("conversation_id", conversationId)
    .eq("author", "client").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? new Date(data.created_at) : null;
}

async function isTestContact(db: SupabaseClient, conversationId: string): Promise<boolean> {
  const { data } = await db.from("conversations").select("contact:contacts(is_test)").eq("id", conversationId).maybeSingle();
  return !!(data?.contact as unknown as { is_test: boolean } | null)?.is_test;
}

/**
 * Envía todo lo pendiente del canal por la API de Meta. Seguro de llamar en paralelo (claim_outbound usa skip locked).
 * Devuelve cuántos salieron y cuántos fallaron.
 */
export async function drainMetaOutbound(
  db: SupabaseClient, client: MetaClient, ch: MetaChannel, opts: { maxJobs?: number; now?: () => number } = {},
): Promise<{ sent: number; failed: number }> {
  const now = opts.now ?? Date.now;
  const res = { sent: 0, failed: 0 };
  await db.rpc("fail_stale_sending", { p_channel_id: ch.id, p_seconds: 120 });
  for (let i = 0; i < (opts.maxJobs ?? 20); i++) {
    const { data, error } = await db.rpc("claim_outbound", { p_channel_id: ch.id });
    if (error) { console.error("[meta] no se pudo tomar de la cola: %s", error.message); break; }
    const job = (data as Outbound[] | null)?.[0];
    if (!job) break;

    const fail = async (msg: string, permanent: boolean) => {
      await db.rpc("mark_outbound_result", { p_outbound_id: job.id, p_ok: false, p_wa_message_id: null, p_error: msg,
        ...(permanent ? { p_max_attempts: 0 } : {}) });
      res.failed++;
    };
    if (await isTestContact(db, job.conversation_id)) { await fail("contacto de prueba: no se envía por WhatsApp real", true); continue; }
    // Texto libre solo dentro de las 24 h; una plantilla aprobada puede salir siempre (la aprobó un dueño).
    if (!job.template) {
      const last = await lastClientMessageAt(db, job.conversation_id);
      if (!last || now() - last.getTime() > SERVICE_WINDOW_MS) { await fail(WINDOW_CLOSED_ERROR, true); continue; }
    }

    try {
      const to = job.to_phone.split("@")[0];
      const wamid = job.template
        ? await client.sendTemplate(ch.meta_phone_number_id, to, job.template)
        : await client.sendText(ch.meta_phone_number_id, to, job.body);
      const { error: e2 } = await db.rpc("mark_outbound_result", { p_outbound_id: job.id, p_ok: true, p_wa_message_id: wamid, p_error: null });
      if (e2) console.error("[meta] salió pero no se pudo marcar outbound=%s", job.id);
      res.sent++;
    } catch (e) {
      const permanent = e instanceof MetaApiError && e.permanent;
      console.warn("[meta] falló un envío outbound=%s intento=%d: %s", job.id, job.attempts, (e as Error).message.slice(0, 160));
      await fail((e as Error).message, permanent);
    }
  }
  return res;
}

/**
 * Si la conversación es de un canal de Meta, envía lo pendiente de ese canal. Con Baileys no hace nada (despacha el worker).
 * Lo usan el bot (después de su turno) y el panel (después de que un dueño responde o reintenta).
 */
export async function drainForConversation(db: SupabaseClient, client: MetaClient | null, conversationId: string) {
  const { data } = await db.from("conversations")
    .select("channel:channels(id, slug, transport, meta_phone_number_id)").eq("id", conversationId).maybeSingle();
  const ch = data?.channel as unknown as (MetaChannel & { transport: string }) | null;
  if (!ch || ch.transport !== "meta") return null;
  if (!client || !ch.meta_phone_number_id) {
    console.error("[meta] canal de Meta sin configurar (token o phone_number_id) conv=%s", conversationId);
    return null;
  }
  return drainMetaOutbound(db, client, ch);
}

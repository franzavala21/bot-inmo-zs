import type { SupabaseClient } from "@supabase/supabase-js";
import type { WAMessage } from "baileys";
import { config } from "./config";
import { log } from "./log";
import type { Transport } from "./transport";

const EXT: Record<string, string> = {
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

/** Baja el audio o la imagen y lo guarda en el bucket privado "media". Devuelve la ruta o null. */
export async function storeMedia(db: SupabaseClient, transport: Transport, msg: WAMessage, waMessageId: string): Promise<string | null> {
  try {
    const file = await transport.downloadMedia(msg);
    if (!file) return null;
    if (file.data.length > config.maxMediaBytes) {
      log.warn("archivo demasiado grande, no se guarda", { wa_message_id: waMessageId, bytes: file.data.length });
      return null;
    }
    const mime = file.mime.split(";")[0].trim();
    const now = new Date();
    const safeId = waMessageId.replace(/[^A-Za-z0-9_-]/g, "");
    const path = `wa/${config.channelSlug}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${safeId}.${EXT[mime] ?? "bin"}`;
    const { error } = await db.storage.from("media").upload(path, file.data, { contentType: mime, upsert: true });
    if (error) throw error;
    return path;
  } catch (e) {
    log.warn("no se pudo guardar el archivo", { wa_message_id: waMessageId, error: (e as Error).message });
    return null;
  }
}

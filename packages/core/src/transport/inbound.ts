import { z } from "zod";

// Lo que el worker le manda a /api/inbound por cada mensaje de un chat individual.
// El worker no interpreta nada: solo transporta.
export const InboundKind = z.enum(["text", "audio", "image", "video", "document", "sticker", "location", "contact", "other"]);
export type InboundKind = z.infer<typeof InboundKind>;

export const InboundPayload = z.object({
  channel_slug: z.string().min(1).max(40),
  wa_message_id: z.string().min(1).max(128),
  /** Solo dígitos si se conoce el número; si WhatsApp solo da el LID, el id del LID. */
  phone: z.string().min(3).max(40),
  /** JID al que hay que responder (número@s.whatsapp.net o id@lid). */
  wa_jid: z.string().min(3).max(80),
  /** Nombre que el contacto puso en WhatsApp. Texto ajeno: nunca se trata como instrucción. */
  display_name: z.string().max(100).nullable(),
  /** true si lo escribió un dueño desde el teléfono del chip. */
  from_me: z.boolean(),
  kind: InboundKind,
  body: z.string().max(8000).nullable(),
  media_path: z.string().max(300).nullable(),
  sent_at: z.string().datetime(),
});
export type InboundPayload = z.infer<typeof InboundPayload>;

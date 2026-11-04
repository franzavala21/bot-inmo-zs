import {
  isJidBroadcast, isJidGroup, isJidNewsletter, isJidStatusBroadcast, isLidUser, isPnUser, jidDecode, jidNormalizedUser,
  type WAMessage, type WAMessageContent,
} from "baileys";
import type { InboundKind } from "@inmo/core/transport/inbound";

/** Mensaje de un chat individual, listo para mandar a la web (salvo la ruta del archivo, que se agrega después). */
export interface Extracted {
  waMessageId: string;
  phone: string;
  waJid: string;
  displayName: string | null;
  fromMe: boolean;
  kind: InboundKind;
  body: string | null;
  sentAt: Date;
  /** true si hay un audio o una imagen para bajar y guardar. */
  hasMedia: boolean;
}

// Envoltorios que WhatsApp pone alrededor del contenido real.
function unwrap(m: WAMessageContent | null | undefined): WAMessageContent | null {
  let cur = m ?? null;
  for (let i = 0; i < 5 && cur; i++) {
    const inner =
      cur.ephemeralMessage?.message ?? cur.viewOnceMessage?.message ?? cur.viewOnceMessageV2?.message ??
      cur.viewOnceMessageV2Extension?.message ?? cur.documentWithCaptionMessage?.message ?? cur.editedMessage?.message;
    if (!inner) break;
    cur = inner;
  }
  return cur;
}

const toDate = (t: WAMessage["messageTimestamp"]): Date => {
  const n = t == null ? NaN : typeof t === "number" ? t : Number(t.toString());
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

const clip = (s: string | null | undefined, max = 8000) => (s ? s.slice(0, max) : null);

/** Qué tipo de mensaje es y qué texto lleva. null = no es un mensaje para la bandeja (reacción, borrado, sistema). */
export function classify(content: WAMessageContent): { kind: InboundKind; body: string | null; hasMedia: boolean } | null {
  if (content.conversation) return { kind: "text", body: clip(content.conversation), hasMedia: false };
  if (content.extendedTextMessage?.text) return { kind: "text", body: clip(content.extendedTextMessage.text), hasMedia: false };
  if (content.audioMessage) return { kind: "audio", body: null, hasMedia: true };
  if (content.imageMessage) return { kind: "image", body: clip(content.imageMessage.caption), hasMedia: true };
  if (content.videoMessage) return { kind: "video", body: clip(content.videoMessage.caption), hasMedia: false };
  if (content.documentMessage)
    return { kind: "document", body: clip(content.documentMessage.caption ?? content.documentMessage.fileName), hasMedia: false };
  if (content.stickerMessage) return { kind: "sticker", body: null, hasMedia: false };
  const loc = content.locationMessage ?? content.liveLocationMessage;
  if (loc) {
    const name = "name" in loc && loc.name ? `${loc.name} ` : "";
    return { kind: "location", body: `${name}(${loc.degreesLatitude}, ${loc.degreesLongitude})`, hasMedia: false };
  }
  if (content.contactMessage) return { kind: "contact", body: clip(content.contactMessage.displayName), hasMedia: false };
  if (content.contactsArrayMessage) return { kind: "contact", body: clip(content.contactsArrayMessage.displayName), hasMedia: false };

  // Mensajes de sistema que no van a la bandeja.
  const IGNORED = new Set([
    "protocolMessage", "reactionMessage", "senderKeyDistributionMessage", "messageContextInfo", "pollUpdateMessage",
    "keepInChatMessage", "pinInChatMessage", "encReactionMessage", "callLogMesssage", "botInvokeMessage",
  ]);
  const keys = Object.keys(content).filter((k) => (content as Record<string, unknown>)[k] != null);
  if (keys.length === 0 || keys.every((k) => IGNORED.has(k))) return null;
  return { kind: "other", body: null, hasMedia: false };
}

/**
 * Convierte un mensaje de Baileys. Devuelve null si no corresponde a la bandeja:
 * grupos, estados, difusiones, canales o mensajes de sistema.
 */
export function extract(msg: WAMessage): Extracted | null {
  const key = msg.key;
  const remote = key?.remoteJid ?? undefined;
  if (!key?.id || !remote) return null;
  if (isJidGroup(remote) || isJidBroadcast(remote) || isJidStatusBroadcast(remote) || isJidNewsletter(remote)) return null;
  if (!isPnUser(remote) && !isLidUser(remote)) return null;

  const content = unwrap(msg.message);
  if (!content) return null;
  const c = classify(content);
  if (!c) return null;

  // Preferimos el número real; si WhatsApp solo da el LID, usamos ese para identificar y responder.
  const alt = key.remoteJidAlt;
  const pnJid = isPnUser(remote) ? remote : alt && isPnUser(alt) ? alt : null;
  const replyJid = jidNormalizedUser(pnJid ?? remote);
  const user = jidDecode(replyJid)?.user;
  if (!user) return null;
  const phone = pnJid ? user : `lid:${user}`;

  return {
    waMessageId: key.id,
    phone,
    waJid: replyJid,
    displayName: key.fromMe ? null : clip(msg.pushName, 100),
    fromMe: !!key.fromMe,
    kind: c.kind,
    body: c.body,
    sentAt: toDate(msg.messageTimestamp),
    hasMedia: c.hasMedia,
  };
}

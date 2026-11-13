// API oficial de WhatsApp (Meta Cloud API): firma del webhook, lectura de eventos y cliente de envío.
// Solo transporte: no interpreta los mensajes.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { InboundKind } from "./inbound";

export const META_SIGNATURE_HEADER = "x-hub-signature-256";

/** Verifica X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con el App Secret). */
export function verifyMetaSignature(appSecret: string | undefined, header: string | null, raw: string): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

// ───────── Webhook ─────────
const Media = z.object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional(), filename: z.string().optional() });
const Msg = z.object({
  from: z.string().optional(),
  to: z.string().optional(), // en los ecos (mensajes que un dueño manda desde la app del teléfono)
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  audio: Media.optional(), image: Media.optional(), video: Media.optional(), document: Media.optional(), sticker: Media.optional(),
  location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().optional(), address: z.string().optional() }).optional(),
  contacts: z.array(z.object({ name: z.object({ formatted_name: z.string().optional() }).optional() })).optional(),
  button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
  interactive: z.object({
    button_reply: z.object({ title: z.string() }).optional(),
    list_reply: z.object({ title: z.string() }).optional(),
  }).optional(),
}).passthrough();
const Status = z.object({
  id: z.string(), status: z.string(), recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() })).optional(),
}).passthrough();
const Value = z.object({
  metadata: z.object({ phone_number_id: z.string() }).optional(),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(Msg).optional(),
  message_echoes: z.array(Msg).optional(),
  statuses: z.array(Status).optional(),
}).passthrough();
export const MetaWebhook = z.object({
  object: z.string(),
  entry: z.array(z.object({ changes: z.array(z.object({ field: z.string(), value: Value })) })),
});

export interface MetaInbound {
  phoneNumberId: string;
  waMessageId: string;
  /** wa_id del cliente (solo dígitos). */
  phone: string;
  displayName: string | null;
  /** true si lo mandó un dueño desde la app del teléfono (coexistencia). */
  fromMe: boolean;
  kind: InboundKind;
  body: string | null;
  /** Id de Meta del archivo a bajar (solo audio e imagen, como con Baileys). */
  mediaId: string | null;
  /** Payload del botón de una plantilla que tocó el cliente (ej. "OPT_OUT"), o null. */
  buttonPayload?: string | null;
  sentAt: Date;
}
export interface MetaStatusFailure { waMessageId: string; error: string }

const clip = (s: string | null | undefined, max = 8000) => (s ? s.slice(0, max) : null);
const digits = (s: string) => s.replace(/\D/g, "");

/** Tipo y texto del mensaje. null = no va a la bandeja (reacción, sistema). */
export function classifyMeta(m: z.infer<typeof Msg>): { kind: InboundKind; body: string | null; mediaId: string | null } | null {
  switch (m.type) {
    case "text": return { kind: "text", body: clip(m.text?.body), mediaId: null };
    case "audio": return { kind: "audio", body: null, mediaId: m.audio?.id ?? null };
    case "image": return { kind: "image", body: clip(m.image?.caption), mediaId: m.image?.id ?? null };
    case "video": return { kind: "video", body: clip(m.video?.caption), mediaId: null };
    case "document": return { kind: "document", body: clip(m.document?.caption ?? m.document?.filename), mediaId: null };
    case "sticker": return { kind: "sticker", body: null, mediaId: null };
    case "location": {
      const l = m.location; if (!l) return { kind: "location", body: null, mediaId: null };
      return { kind: "location", body: `${l.name ? l.name + " " : ""}(${l.latitude}, ${l.longitude})`, mediaId: null };
    }
    case "contacts": return { kind: "contact", body: clip(m.contacts?.[0]?.name?.formatted_name), mediaId: null };
    case "button": return { kind: "text", body: clip(m.button?.text), mediaId: null };
    case "interactive": return { kind: "text", body: clip(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title), mediaId: null };
    case "reaction": case "system": case "ephemeral": case "request_welcome": return null;
    default: return { kind: "other", body: null, mediaId: null };
  }
}

/** Saca del webhook los mensajes (del cliente y ecos de la app) y los avisos de envío fallido. */
export function parseMetaWebhook(json: unknown): { inbound: MetaInbound[]; failures: MetaStatusFailure[] } | null {
  const p = MetaWebhook.safeParse(json);
  if (!p.success || p.data.object !== "whatsapp_business_account") return null;
  const inbound: MetaInbound[] = [];
  const failures: MetaStatusFailure[] = [];
  for (const e of p.data.entry) for (const ch of e.changes) {
    const v = ch.value;
    const phoneNumberId = v.metadata?.phone_number_id;
    if (!phoneNumberId) continue;
    const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
    const add = (m: z.infer<typeof Msg>, fromMe: boolean) => {
      const peer = fromMe ? m.to : m.from;
      const c = classifyMeta(m);
      if (!peer || !c) return;
      const ts = Number(m.timestamp);
      inbound.push({
        phoneNumberId, waMessageId: m.id, phone: digits(peer), displayName: fromMe ? null : clip(names.get(peer) ?? null, 100),
        fromMe, kind: c.kind, body: c.body, mediaId: c.mediaId, buttonPayload: m.button?.payload ?? null, sentAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
      });
    };
    if (ch.field === "messages") for (const m of v.messages ?? []) add(m, false);
    if (ch.field === "smb_message_echoes") for (const m of v.message_echoes ?? []) add(m, true);
    if (ch.field === "messages") for (const s of v.statuses ?? []) {
      if (s.status !== "failed") continue;
      const err = s.errors?.[0];
      failures.push({ waMessageId: s.id, error: `meta ${err?.code ?? "?"}: ${err?.title ?? err?.message ?? "no entregado"}` });
    }
  }
  return { inbound, failures };
}

// ───────── Cliente de envío ─────────
export class MetaApiError extends Error {
  constructor(message: string, readonly code: number | null, readonly httpStatus: number) { super(message); }
  /** Errores que no se arreglan reintentando: se marcan fallidos de una. */
  get permanent(): boolean {
    const PERMANENT = new Set([131047, 131026, 131030, 131051, 131052, 131053, 132000, 132001, 100, 190, 10, 200, 131031, 131008, 131009, 131048, 131049]);
    return (this.code != null && PERMANENT.has(this.code)) || this.httpStatus === 401 || this.httpStatus === 403;
  }
}

export interface MetaConfig { accessToken: string; graphVersion: string; fetchImpl?: typeof fetch }

export function metaConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MetaConfig | null {
  if (!env.META_ACCESS_TOKEN) return null;
  return { accessToken: env.META_ACCESS_TOKEN, graphVersion: env.META_GRAPH_VERSION || "v26.0" };
}

/** Plantilla a enviar (se guarda tal cual en outbound_messages.template). */
export interface TemplateSend { name: string; language: string; params: string[]; buttons?: string[] }

export class MetaClient {
  private f: typeof fetch;
  constructor(private cfg: MetaConfig) { this.f = cfg.fetchImpl ?? fetch; }
  private url(path: string) { return `https://graph.facebook.com/${this.cfg.graphVersion}/${path}`; }
  private async call(path: string, init: RequestInit = {}): Promise<any> {
    const r = await this.f(this.url(path), {
      ...init, headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = json?.error ?? {};
      throw new MetaApiError(`meta ${e.code ?? r.status}: ${e.error_data?.details ?? e.message ?? "error"}`.slice(0, 300), e.code ?? null, r.status);
    }
    return json;
  }

  /** Envía texto y devuelve el id del mensaje (wamid). */
  async sendText(phoneNumberId: string, to: string, body: string): Promise<string> {
    const json = await this.call(`${phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), type: "text", text: { body, preview_url: false } }),
    });
    const id = json?.messages?.[0]?.id;
    if (!id) throw new MetaApiError("meta: respuesta sin id de mensaje", null, 200);
    return id;
  }

  /**
   * Envía una plantilla aprobada (fuera de las 24 h). params = variables del cuerpo en orden;
   * buttons = payloads de los botones de respuesta rápida en orden (para saber cuál tocó el cliente).
   */
  async sendTemplate(phoneNumberId: string, to: string, t: TemplateSend): Promise<string> {
    const components: unknown[] = [];
    if (t.params.length) components.push({ type: "body", parameters: t.params.map((text) => ({ type: "text", text })) });
    (t.buttons ?? []).forEach((payload, i) => components.push({ type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }] }));
    const json = await this.call(`${phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), type: "template",
        template: { name: t.name, language: { code: t.language }, components } }),
    });
    const id = json?.messages?.[0]?.id;
    if (!id) throw new MetaApiError("meta: respuesta sin id de mensaje", null, 200);
    return id;
  }

  /** Baja un archivo por su id de Meta. */
  async downloadMedia(mediaId: string, maxBytes: number): Promise<{ data: Buffer; mime: string } | null> {
    const info = await this.call(mediaId);
    if (!info?.url) return null;
    if (info.file_size && info.file_size > maxBytes) return null;
    const r = await this.f(info.url, { headers: { Authorization: `Bearer ${this.cfg.accessToken}` }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new MetaApiError(`meta: no se pudo bajar el archivo (${r.status})`, null, r.status);
    const data = Buffer.from(await r.arrayBuffer());
    if (data.length > maxBytes) return null;
    return { data, mime: String(info.mime_type ?? r.headers.get("content-type") ?? "application/octet-stream") };
  }

  /** Estado del número, para la pantalla Conexión. */
  async phoneInfo(phoneNumberId: string): Promise<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }> {
    return this.call(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
  }
}

import { rename } from "node:fs/promises";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, jidDecode,
  makeCacheableSignalKeyStore, useMultiFileAuthState, type WAMessage, type WAMessageKey, type proto,
} from "baileys";
import pino from "pino";
import { config } from "./config";
import { log } from "./log";
import type { Transport, TransportEvents } from "./transport";

type Socket = ReturnType<typeof makeWASocket>;

/**
 * WhatsApp vía Baileys. Solo transporte: no decide nada.
 * Riesgo de bloqueo: se usa un chip aparte (nunca el número principal) y se envía a ritmo humano.
 */
export class BaileysTransport implements Transport {
  private sock: Socket | null = null;
  private online = false;
  private events!: TransportEvents;
  private stopped = false;
  private retry = 0;
  private logger = pino({ level: config.baileysLogLevel });
  // WhatsApp pide reenviar un mensaje si el destinatario no lo pudo descifrar: guardamos los últimos enviados.
  private sent = new Map<string, proto.IMessage>();

  async start(events: TransportEvents) {
    this.events = events;
    await this.connect();
  }

  isOnline() { return this.online; }

  private async connect() {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    let version: [number, number, number] | undefined;
    try { version = (await fetchLatestBaileysVersion()).version; } catch { /* usa la que trae Baileys */ }

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.logger) },
      logger: this.logger,
      browser: Browsers.macOS("Desktop"),
      // Que el teléfono siga recibiendo notificaciones: los dueños también usan la app.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      getMessage: async (key: WAMessageKey) => (key.id ? this.sent.get(key.id) : undefined),
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (u.qr) {
        log.info("QR nuevo: escanearlo desde el panel (Conexión)");
        await this.events.onStatus({ status: "offline", qr: u.qr });
      }
      if (u.connection === "open") {
        this.online = true;
        this.retry = 0;
        const phone = jidDecode(sock.user?.id)?.user ?? null;
        log.info("WhatsApp conectado");
        await this.events.onStatus({ status: "online", qr: null, phone });
      }
      if (u.connection === "close") {
        this.online = false;
        const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (this.stopped) return;
        if (code === DisconnectReason.loggedOut) {
          // Se desvinculó desde el teléfono. No se borra nada: se archiva la sesión y se pide un QR nuevo.
          const archived = `${config.authDir}-desvinculada-${Date.now()}`;
          log.warn("sesión desvinculada desde el teléfono; se archiva y se pide QR nuevo", { archived });
          await rename(config.authDir, archived).catch(() => {});
          await this.events.onStatus({ status: "offline", qr: null });
          setTimeout(() => void this.connect(), 2_000);
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          // Otra instancia del worker abrió la misma sesión: no peleamos por ella.
          log.error("la sesión se abrió en otro lugar (¿dos workers?); este se detiene");
          await this.events.onStatus({ status: "offline", qr: null });
          return;
        }
        const wait = code === DisconnectReason.restartRequired ? 0 : Math.min(2 ** this.retry++ * 1000, 60_000);
        log.warn("conexión cerrada, reconectando", { code, wait_ms: wait });
        await this.events.onStatus({ status: "reconnecting" });
        setTimeout(() => void this.connect(), wait);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const m of messages) {
        try { await this.events.onMessage(m); } catch (e) { log.error("error procesando un mensaje", { error: (e as Error).message }); }
      }
    });
  }

  async sendText(toJid: string, text: string): Promise<string> {
    const sock = this.sock;
    if (!sock || !this.online) throw new Error("WhatsApp no está conectado");
    // Ritmo humano: "escribiendo…" un rato proporcional al largo, con tope.
    await sock.presenceSubscribe(toJid).catch(() => {});
    await sock.sendPresenceUpdate("composing", toJid).catch(() => {});
    await new Promise((r) => setTimeout(r, Math.min(800 + text.length * 25, 4_000)));
    await sock.sendPresenceUpdate("paused", toJid).catch(() => {});

    const res = await sock.sendMessage(toJid, { text });
    const id = res?.key?.id;
    if (!id) throw new Error("WhatsApp no devolvió id de mensaje");
    if (res.message) {
      this.sent.set(id, res.message);
      if (this.sent.size > 500) this.sent.delete(this.sent.keys().next().value!);
    }
    return id;
  }

  async downloadMedia(msg: WAMessage) {
    if (!this.sock) return null;
    const m = msg.message;
    const inner = m?.ephemeralMessage?.message ?? m?.viewOnceMessage?.message ?? m?.viewOnceMessageV2?.message ?? m;
    const mime = inner?.audioMessage?.mimetype ?? inner?.imageMessage?.mimetype;
    if (!mime) return null;
    const data = await downloadMediaMessage(msg, "buffer", {}, { logger: this.logger, reuploadRequest: this.sock.updateMediaMessage });
    return { data, mime };
  }

  async stop() {
    this.stopped = true;
    this.online = false;
    this.sock?.end(undefined);
  }
}

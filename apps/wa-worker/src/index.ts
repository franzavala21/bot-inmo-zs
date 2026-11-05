import { createServer } from "node:http";
import { adminClient } from "@inmo/core/db/admin";
import type { WAMessage } from "baileys";
import { BaileysTransport } from "./baileys-transport";
import { config } from "./config";
import { Dispatcher } from "./dispatcher";
import { extract } from "./extract";
import { pendingInbound, sendInbound } from "./inbound-client";
import { log } from "./log";
import { storeMedia } from "./media";
import { ChannelStatus } from "./status";
import { FakeTransport, type Transport } from "./transport";

// Worker de WhatsApp: SOLO transporte. Recibe, firma y manda a la web; despacha la cola de salida.
// No interpreta mensajes ni decide respuestas: eso vive en la web (packages/core).

const BOOT = Date.now();
// Al vincular, WhatsApp puede reenviar mensajes viejos. Solo tomamos los recientes.
const MAX_AGE_MS = 10 * 60_000;

async function main() {
  const db = adminClient();
  const { data: channel, error } = await db.from("channels").select("id").eq("slug", config.channelSlug).single();
  if (error || !channel) throw new Error(`No existe el canal "${config.channelSlug}" en la tabla channels`);

  const transport: Transport = config.transport === "fake" ? new FakeTransport() : new BaileysTransport();
  const status = new ChannelStatus(db, channel.id);
  const dispatcher = new Dispatcher(db, transport, channel.id, config.transport !== "fake");

  async function onMessage(msg: WAMessage) {
    const m = extract(msg);
    if (!m) return;
    if (m.fromMe && dispatcher.sentIds.has(m.waMessageId)) return; // eco de lo que mandamos nosotros
    if (m.sentAt.getTime() < BOOT - MAX_AGE_MS) return;
    const mediaPath = m.hasMedia ? await storeMedia(db, transport, msg, m.waMessageId) : null;
    sendInbound({
      channel_slug: config.channelSlug, wa_message_id: m.waMessageId, phone: m.phone, wa_jid: m.waJid,
      display_name: m.displayName, from_me: m.fromMe, kind: m.kind, body: m.body, media_path: mediaPath,
      sent_at: m.sentAt.toISOString(),
    });
  }

  await transport.start({
    onMessage,
    onStatus: async (s) => {
      await status.set(s);
      if (s.status === "online") dispatcher.kick();
    },
  });
  status.startHeartbeat();
  await dispatcher.start();

  // Healthcheck para Railway.
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: status.current, online: transport.isOnline(), pending_inbound: pendingInbound(), transport: config.transport }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(config.port, () => log.info("worker listo", { canal: config.channelSlug, transporte: config.transport, puerto: config.port }));

  const shutdown = async (sig: string) => {
    log.info("apagando", { signal: sig });
    dispatcher.stop();
    status.stop();
    await transport.stop();
    await status.set({ status: "offline" });
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  log.error("el worker no pudo arrancar", { error: (e as Error).message });
  process.exit(1);
});

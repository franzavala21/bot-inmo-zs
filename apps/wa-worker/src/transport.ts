import type { WAMessage } from "baileys";

export type WorkerStatus = "online" | "reconnecting" | "offline";

export interface TransportEvents {
  onMessage: (msg: WAMessage) => void | Promise<void>;
  onStatus: (s: { status: WorkerStatus; qr?: string | null; phone?: string | null }) => void | Promise<void>;
}

/** El worker solo conoce esta interfaz: así Baileys se puede cambiar por la API de Meta sin tocar el resto. */
export interface Transport {
  start(events: TransportEvents): Promise<void>;
  isOnline(): boolean;
  /** Envía texto y devuelve el id del mensaje en WhatsApp. */
  sendText(toJid: string, text: string): Promise<string>;
  /** Descarga el archivo de un mensaje (audio o imagen). */
  downloadMedia(msg: WAMessage): Promise<{ data: Buffer; mime: string } | null>;
  stop(): Promise<void>;
}

/** Transporte de prueba: no se conecta a WhatsApp. Sirve para probar el circuito completo sin chip. */
export class FakeTransport implements Transport {
  private n = 0;
  async start(events: TransportEvents) { await events.onStatus({ status: "online", qr: null }); }
  isOnline() { return true; }
  async sendText() { return `FAKE-${Date.now()}-${++this.n}`; }
  async downloadMedia() { return null; }
  async stop() {}
}

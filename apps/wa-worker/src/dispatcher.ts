import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";
import type { Transport } from "./transport";

type Outbound = { id: string; to_phone: string; body: string; attempts: number };

/**
 * Despacha outbound_messages del canal: humano primero, de a uno y a ritmo humano.
 * Se despierta por Realtime (INSERT) y, por si Realtime se cae, revisa la cola cada 15 s.
 */
export class Dispatcher {
  private running = false;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  /** Ids de WhatsApp que mandamos nosotros: su eco en messages.upsert no se reenvía a la web. */
  readonly sentIds = new Set<string>();

  constructor(private db: SupabaseClient, private transport: Transport, private channelId: string) {}

  async start() {
    const { data: n, error } = await this.db.rpc("fail_interrupted_outbound", { p_channel_id: this.channelId });
    if (error) log.error("no se pudieron revisar envíos interrumpidos", { error: error.message });
    else if (n) log.warn("envíos interrumpidos marcados para revisar", { count: n });

    this.db.channel(`outbound-${this.channelId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "outbound_messages", filter: `channel_id=eq.${this.channelId}` },
        () => this.kick())
      .subscribe((s) => log.info("realtime de la cola de salida", { estado: s }));
    this.timer = setInterval(() => this.kick(), 15_000);
    this.kick();
  }

  stop() { if (this.timer) clearInterval(this.timer); }

  kick() {
    if (this.running) { this.again = true; return; }
    void this.loop();
  }

  private async loop() {
    this.running = true;
    try {
      do {
        this.again = false;
        while (this.transport.isOnline()) {
          const { data, error } = await this.db.rpc("claim_outbound", { p_channel_id: this.channelId });
          if (error) { log.error("no se pudo tomar de la cola", { error: error.message }); break; }
          const job = (data as Outbound[] | null)?.[0];
          if (!job) break;
          await this.send(job);
          await new Promise((r) => setTimeout(r, 1_500 + Math.random() * 1_500));
        }
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  private async send(job: Outbound) {
    const to = job.to_phone.includes("@") ? job.to_phone : `${job.to_phone.replace(/\D/g, "")}@s.whatsapp.net`;
    try {
      const waId = await this.transport.sendText(to, job.body);
      this.sentIds.add(waId);
      if (this.sentIds.size > 1000) this.sentIds.delete(this.sentIds.values().next().value!);
      const { error } = await this.db.rpc("mark_outbound_result", { p_outbound_id: job.id, p_ok: true, p_wa_message_id: waId, p_error: null });
      if (error) log.error("salió pero no se pudo marcar como enviado", { outbound_id: job.id, error: error.message });
      else log.info("mensaje enviado", { outbound_id: job.id });
    } catch (e) {
      const msg = (e as Error).message;
      log.warn("falló un envío", { outbound_id: job.id, attempts: job.attempts, error: msg });
      await this.db.rpc("mark_outbound_result", { p_outbound_id: job.id, p_ok: false, p_wa_message_id: null, p_error: msg });
    }
  }
}

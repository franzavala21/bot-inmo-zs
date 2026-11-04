import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "./log";
import type { WorkerStatus } from "./transport";

/** Estado del canal en la tabla channels: lo lee el panel (Conexión) por Realtime. */
export class ChannelStatus {
  current: WorkerStatus = "offline";
  lastHeartbeat: Date | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private db: SupabaseClient, private channelId: string) {}

  async set(s: { status: WorkerStatus; qr?: string | null; phone?: string | null }) {
    this.current = s.status;
    const patch: Record<string, unknown> = { worker_status: s.status, worker_heartbeat_at: new Date().toISOString() };
    if (s.qr !== undefined) patch.worker_qr = s.qr;
    if (s.phone) patch.phone = s.phone;
    const { error } = await this.db.from("channels").update(patch).eq("id", this.channelId);
    if (error) log.error("no se pudo actualizar el estado del canal", { error: error.message });
  }

  startHeartbeat() {
    this.timer = setInterval(async () => {
      this.lastHeartbeat = new Date();
      const { error } = await this.db.from("channels")
        .update({ worker_heartbeat_at: this.lastHeartbeat.toISOString(), worker_status: this.current })
        .eq("id", this.channelId);
      if (error) log.warn("latido fallido", { error: error.message });
    }, 30_000);
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}

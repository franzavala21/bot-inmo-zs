import Link from "next/link";
import { serverClient } from "@/lib/supabase/server";

export type WorkerState = "online" | "qr" | "reconnecting" | "down" | "meta";

/** Si el worker no late hace más de 2 min, está caído aunque la tabla diga otra cosa. */
export function workerState(c: { transport?: string; worker_status: string; worker_qr: string | null; worker_heartbeat_at: string | null }): WorkerState {
  if (c.transport === "meta") return "meta"; // sin worker: Meta le avisa a la web
  const fresh = !!c.worker_heartbeat_at && Date.now() - new Date(c.worker_heartbeat_at).getTime() < 120_000;
  if (!fresh) return "down";
  if (c.worker_qr) return "qr";
  if (c.worker_status === "online") return "online";
  return "reconnecting";
}

export const STATE_UI: Record<WorkerState, { label: string; cls: string }> = {
  online: { label: "WhatsApp conectado", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  qr: { label: "Falta escanear el QR", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  reconnecting: { label: "Reconectando…", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  down: { label: "Worker apagado", cls: "bg-red-50 text-red-800 border-red-200" },
  meta: { label: "WhatsApp oficial (Meta)", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
};

export async function WorkerBadge() {
  const sb = await serverClient();
  const { data: c } = await sb.from("channels").select("transport, worker_status, worker_qr, worker_heartbeat_at").eq("slug", "ventas").maybeSingle();
  const s = c ? workerState(c) : "down";
  return (
    <Link href="/conexion" className={`rounded-full border px-3 py-1 text-xs ${STATE_UI[s].cls}`}>{STATE_UI[s].label}</Link>
  );
}

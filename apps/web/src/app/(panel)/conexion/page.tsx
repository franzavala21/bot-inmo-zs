import { PageHeader } from "@/components/page-header";
import QRCode from "qrcode";
import { MetaClient, metaConfigFromEnv } from "@inmo/core";
import { ownerClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { phonePretty, timeAgo } from "@/lib/format";
import { STATE_UI, workerState } from "./worker-badge";
import { BotToggle } from "./bot-toggle";

export default async function Conexion() {
  const sb = await ownerClient();
  const { data: channels } = await sb.from("channels")
    .select("id, slug, name, phone, active, transport, meta_phone_number_id, worker_status, worker_qr, worker_heartbeat_at, bot_enabled").order("created_at");
  const rows = await Promise.all((channels ?? []).map(async (c) => {
    const s = workerState(c);
    const qrSvg = s === "qr" && c.worker_qr ? await QRCode.toString(c.worker_qr, { type: "svg", margin: 1 }) : null;
    return { c, s, qrSvg, meta: s === "meta" ? await metaHealth(c.meta_phone_number_id) : null };
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <RealtimeRefresh tables={["channels"]} />
      <PageHeader title="Conexión de WhatsApp" description="Estado del número, del bot y de la calidad del número en Meta." />
      {rows.map(({ c, s, qrSvg, meta }) => {
        return (
          <section key={c.id} className="space-y-3 rounded-xl border border-zinc-200 bg-white shadow-sm p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="text-sm text-zinc-500">
                  {c.phone ? phonePretty(c.phone) : "Sin número vinculado"} · {c.transport === "baileys" ? "Baileys" : "API de Meta"}
                </div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs ${STATE_UI[s].cls}`}>{STATE_UI[s].label}</span>
            </div>
            {meta ? (
              <p className={`text-sm ${meta.ok ? "text-zinc-600" : "text-red-700"}`}>{meta.text}</p>
            ) : (
              <p className="text-xs text-zinc-500">Último latido del worker: {timeAgo(c.worker_heartbeat_at)}</p>
            )}
            <BotToggle channelId={c.id} enabled={!!c.bot_enabled} />
            {qrSvg && (
              <div className="space-y-2">
                <div className="mx-auto w-64 max-w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700">
                  <li>En el teléfono del <b>chip del bot</b> (nunca el número principal), abrí WhatsApp.</li>
                  <li>Ajustes → Dispositivos vinculados → Vincular un dispositivo.</li>
                  <li>Escaneá este código. Se renueva solo cada pocos segundos.</li>
                </ol>
              </div>
            )}
            {s === "down" && (
              <p className="text-sm text-zinc-700">El worker no está corriendo o perdió conexión con la base. Revisá el servicio en Railway.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

const QUALITY: Record<string, string> = { GREEN: "alta", YELLOW: "media", RED: "baja", UNKNOWN: "sin datos" };

/** Consulta a Meta el estado del número (sin datos de clientes). */
async function metaHealth(phoneNumberId: string | null): Promise<{ ok: boolean; text: string }> {
  const cfg = metaConfigFromEnv();
  if (!cfg) return { ok: false, text: "Falta META_ACCESS_TOKEN en Vercel." };
  if (!phoneNumberId) return { ok: false, text: "El canal no tiene asignado el número de Meta (phone_number_id)." };
  try {
    const info = await new MetaClient(cfg).phoneInfo(phoneNumberId);
    return { ok: true, text: `Meta responde: ${info.verified_name ?? "sin nombre"} · ${info.display_phone_number ?? ""} · calidad ${QUALITY[info.quality_rating ?? "UNKNOWN"] ?? info.quality_rating}` };
  } catch (e) {
    return { ok: false, text: `Meta no responde: ${(e as Error).message}` };
  }
}

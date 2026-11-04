import { signedHeaders } from "@inmo/core/transport/hmac";
import type { InboundPayload } from "@inmo/core/transport/inbound";
import { config } from "./config";
import { log } from "./log";

// Manda cada mensaje a /api/inbound firmado. Si la web no responde, reintenta con espera creciente.
// La web es idempotente (wa_message_id), así que reintentar nunca duplica.
const MAX_ATTEMPTS = 12; // ~30 min en total
type Job = { payload: InboundPayload; attempts: number };
const queue: Job[] = [];
let draining = false;

async function postOnce(payload: InboundPayload): Promise<"ok" | "retry" | "drop"> {
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(`${config.webBaseUrl}/api/inbound`, {
      method: "POST", body, headers: signedHeaders(config.hmacSecret, body), signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return "ok";
    // 4xx (salvo 429) no se arregla reintentando: firma o datos mal.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      log.error("la web rechazó un mensaje", { status: res.status, wa_message_id: payload.wa_message_id });
      return "drop";
    }
    log.warn("la web respondió con error, se reintenta", { status: res.status });
    return "retry";
  } catch (e) {
    log.warn("no se pudo contactar a la web, se reintenta", { error: (e as Error).name });
    return "retry";
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const job = queue[0];
      const r = await postOnce(job.payload);
      if (r === "retry" && ++job.attempts < MAX_ATTEMPTS) {
        const wait = Math.min(2 ** job.attempts * 1000, 5 * 60_000);
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      if (r === "retry") log.error("mensaje descartado tras varios reintentos", { wa_message_id: job.payload.wa_message_id });
      queue.shift();
    }
  } finally {
    draining = false;
  }
}

export function sendInbound(payload: InboundPayload) {
  queue.push({ payload, attempts: 0 });
  void drain();
}

export const pendingInbound = () => queue.length;

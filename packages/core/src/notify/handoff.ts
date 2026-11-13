// Aviso por email a los dueños cuando el bot pasa un chat a una persona.
// Va por la API de Resend (sin dependencias). Es interno: no sale hacia el cliente.
// Privacidad: el email lleva el motivo, la hora límite y el link al chat, nunca el teléfono ni el texto del cliente.
import type { SupabaseClient } from "@supabase/supabase-js";
import { lastClientMessageAt, SERVICE_WINDOW_MS } from "../transport/meta-dispatch";

export interface NotifyConfig {
  resendApiKey: string;
  from: string;
  panelUrl: string;
  fetchImpl?: typeof fetch;
}

export function notifyConfigFromEnv(env: Record<string, string | undefined> = process.env): NotifyConfig | null {
  const resendApiKey = env.RESEND_API_KEY;
  const from = env.NOTIFY_FROM;
  const host = env.PANEL_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined);
  if (!resendApiKey || !from || !host) return null;
  return { resendApiKey, from, panelUrl: host.replace(/\/$/, "") };
}

const TZ = "America/Argentina/Cordoba";
const fmt = (d: Date) => new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
}).format(d);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface HandoffEmail { subject: string; text: string; html: string }

/** Arma el email. Puro: se prueba sin red. */
export function buildHandoffEmail(a: { reason: string; link: string; deadline: Date | null; isTest: boolean }): HandoffEmail {
  const reason = a.reason.trim().slice(0, 160) || "El bot necesita a una persona";
  const subject = `${a.isTest ? "[PRUEBA] " : ""}Chat para atender: ${reason.slice(0, 80)}`;
  const limit = a.deadline
    ? `Respondé antes del ${fmt(a.deadline)}: después WhatsApp solo deja mandar plantillas aprobadas.`
    : "No se pudo calcular la hora límite de las 24 h: revisalo cuanto antes.";
  const text = [`El bot pasó un chat a una persona.`, ``, `Motivo: ${reason}`, limit, ``, `Abrir el chat: ${a.link}`].join("\n");
  const html = `<p>El bot pasó un chat a una persona.</p>
<p><b>Motivo:</b> ${esc(reason)}<br>${esc(limit)}</p>
<p><a href="${esc(a.link)}">Abrir el chat en el panel</a></p>`;
  return { subject, text, html };
}

/**
 * Manda el aviso a todos los dueños (tabla allowed_users) y lo anota en la bitácora.
 * Nunca tira: si falla, lo deja anotado y el chat igual queda marcado en el panel.
 */
export async function notifyHandoff(db: SupabaseClient, conversationId: string, cfg: NotifyConfig | null = notifyConfigFromEnv()) {
  const log = (event: string, summary: string, details: Record<string, unknown> = {}) =>
    db.from("audit_log").insert({ conversation_id: conversationId, event, summary, details });
  try {
    if (!cfg) {
      console.warn("[aviso] sin configurar (RESEND_API_KEY / NOTIFY_FROM) conv=%s", conversationId);
      await log("notify_failed", "No se avisó por email: falta configurar el envío");
      return false;
    }
    const [{ data: conv }, { data: owners }, last] = await Promise.all([
      db.from("conversations").select("attention_reason, contact:contacts(is_test)").eq("id", conversationId).maybeSingle(),
      db.from("allowed_users").select("email"),
      lastClientMessageAt(db, conversationId),
    ]);
    const to = (owners ?? []).map((o) => o.email as string).filter(Boolean);
    if (!to.length) { await log("notify_failed", "No se avisó por email: no hay dueños cargados"); return false; }

    const email = buildHandoffEmail({
      reason: (conv?.attention_reason as string | null) ?? "",
      link: `${cfg.panelUrl}/bandeja/${conversationId}`,
      deadline: last ? new Date(last.getTime() + SERVICE_WINDOW_MS) : null,
      isTest: !!(conv?.contact as unknown as { is_test: boolean } | null)?.is_test,
    });
    const res = await (cfg.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": `handoff-${conversationId}-${last?.getTime() ?? 0}` },
      body: JSON.stringify({ from: cfg.from, to, subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 160);
      console.error("[aviso] Resend respondió %d conv=%s", res.status, conversationId);
      await log("notify_failed", "No se pudo avisar por email", { status: res.status, error: body });
      return false;
    }
    await log("notified", `Aviso por email a ${to.length} dueño(s)`);
    return true;
  } catch (e) {
    console.error("[aviso] falló conv=%s: %s", conversationId, (e as Error).message.slice(0, 120));
    await log("notify_failed", "No se pudo avisar por email", { error: (e as Error).message.slice(0, 160) }).then(() => {}, () => {});
    return false;
  }
}

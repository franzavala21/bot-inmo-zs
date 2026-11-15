import Link from "next/link";
import { notFound } from "next/navigation";
import { adminClient, computeSignals, profileFromRow, publishedScoringRules, scoreLead, SERVICE_WINDOW_MS } from "@inmo/core";
import { LeadCard } from "@/components/lead-card";
import { ownerClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { contactLabel, KIND_LABEL, phonePretty, timeShort } from "@/lib/format";
import { Composer } from "./composer";
import { ModeToggle } from "./mode-toggle";
import { RetryButton } from "./retry-button";

type Msg = {
  id: string; author: "client" | "ai" | "human" | "system"; kind: string; body: string | null; media_path: string | null;
  transcript: string | null; created_at: string; outbound_messages: { id: string; status: string; error: string | null; template: unknown }[];
};

const EVENT_CLS: Record<string, string> = {
  handoff: "text-red-700 font-medium", sent_handoff: "text-red-700", rejected_numeric: "text-amber-700",
  rejected_verifier: "text-amber-700", agent_error: "text-red-700", send_failed: "text-red-700", limit: "text-red-700",
  sent: "text-emerald-700", discarded: "text-zinc-500", notified: "text-zinc-500", notify_failed: "text-red-700", lead_updated: "text-zinc-500", suggested: "text-emerald-700", match_found: "text-blue-700", proactive_approved: "text-emerald-700", proactive_discarded: "text-zinc-500", opt_out: "text-red-700", visit_scheduled: "text-blue-700", visit_updated: "text-zinc-600",
};

/** Un detalle corto y legible de cada evento (sin datos personales). */
function auditDetail(event: string, d: unknown): string | null {
  const x = (d ?? {}) as Record<string, unknown>;
  if (event === "classified" && typeof x.confidence === "number") return `confianza ${Math.round(x.confidence * 100)}%`;
  if (event === "searched" && Array.isArray(x.codes)) return x.codes.length ? (x.codes as string[]).join(", ") : null;
  if (event === "rejected_numeric") return [...((x.numbers as number[]) ?? []), ...((x.urls as string[]) ?? [])].join(", ") || null;
  if (event === "rejected_verifier" && Array.isArray(x.problems)) return (x.problems as string[]).join(" / ");
  if ((event === "sent" || event === "sent_handoff") && Array.isArray(x.property_codes) && x.property_codes.length) return (x.property_codes as string[]).join(", ");
  if (event === "agent_error" && typeof x.error === "string") return x.error;
  return null;
}

const STATUS_LABEL: Record<string, string> = { pending: "En cola", sending: "Enviando…", sent: "Enviado", failed: "No salió" };

export default async function Chat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await ownerClient();
  const [{ data: conv }, { data: msgs }] = await Promise.all([
    sb.from("conversations").select("id, mode, needs_attention, attention_reason, channel_id, contact_id, contact:contacts(phone, name, display_name, is_test)").eq("id", id).maybeSingle(),
    sb.from("messages").select("id, author, kind, body, media_path, transcript, created_at, outbound_messages(id, status, error, template)")
      .eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (!conv) notFound();
  const [{ data: channel }, { data: audit }, { data: leadRow }, { data: leadSig }, scoring] = await Promise.all([
    sb.from("channels").select("transport, worker_status, worker_heartbeat_at, bot_enabled").eq("id", conv.channel_id).maybeSingle(),
    sb.from("audit_log").select("id, event, summary, details, created_at").eq("conversation_id", id).order("created_at", { ascending: false }).limit(80),
    sb.from("lead_profiles").select("*").eq("contact_id", conv.contact_id).maybeSingle(),
    sb.from("lead_signals").select("signal").eq("contact_id", conv.contact_id),
    publishedScoringRules(sb),
  ]);
  const lead = profileFromRow(leadRow);
  const leadScore = scoreLead(lead.profile, computeSignals((leadSig ?? []).map((s) => s.signal),
    leadRow?.last_message_at ? new Date(leadRow.last_message_at) : null, Date.now()), scoring.rules);
  const isMeta = channel?.transport === "meta";
  // Con Meta no hay worker: se envía desde la web en el momento.
  const online = isMeta || (channel?.worker_status === "online" &&
    !!channel.worker_heartbeat_at && Date.now() - new Date(channel.worker_heartbeat_at).getTime() < 120_000);

  const messages = ((msgs ?? []) as unknown as Msg[]).reverse();
  const lastClient = [...messages].reverse().find((m) => m.author === "client");
  // Respuesta sugerida por el bot al derivar: solo si nadie respondió después.
  const lastOurs = [...messages].reverse().find((m) => m.author === "ai" || m.author === "human");
  const sug = (audit ?? []).find((a) => a.event === "suggested");
  const suggestion = sug && (!lastOurs || sug.created_at > lastOurs.created_at) ? ((sug.details as { body?: string } | null)?.body ?? null) : null;
  const windowClosed = isMeta && (!lastClient || Date.now() - new Date(lastClient.created_at).getTime() > SERVICE_WINDOW_MS);
  // Bucket privado: links firmados de corta duración para escuchar audios y ver imágenes.
  const paths = messages.map((m) => m.media_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await adminClient().storage.from("media").createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const contact = conv.contact as unknown as { phone: string; name: string | null; display_name: string | null; is_test: boolean } | null;

  return (
    <div className="mx-auto flex h-[calc(100dvh-6.5rem)] max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm md:h-[calc(100dvh-4rem)]">
      <RealtimeRefresh tables={["messages", "conversations", "outbound_messages"]} />
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white p-3">
        <div className="min-w-0">
          <Link href="/bandeja" className="text-sm text-zinc-500">← Bandeja</Link>
          <div className="truncate font-semibold">{contact ? contactLabel(contact) : "?"}</div>
          <div className="text-xs text-zinc-500">{contact ? phonePretty(contact.phone) : ""}{contact?.is_test ? " · prueba" : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/agenda?contacto=${conv.contact_id}`} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm">Agendar visita</Link>
          <ModeToggle conversationId={conv.id} mode={conv.mode} />
        </div>
      </header>
      {conv.needs_attention && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{conv.attention_reason ?? "Necesita atención"}</div>
      )}
      {conv.mode === "ai" && channel && !channel.bot_enabled && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">El bot está apagado: este chat no recibe respuestas automáticas.</div>
      )}
      <details className="border-b border-zinc-200 bg-white px-3 py-2 text-sm">
        <summary className="cursor-pointer text-zinc-600">
          Ficha del lead · puntaje {leadScore.score}{lead.conflicts.length ? " · hay datos para revisar" : ""}{!leadRow ? " · sin armar" : ""}
        </summary>
        <div className="mt-2">
          <LeadCard contactId={conv.contact_id} conversationId={conv.id} profile={lead.profile} conflicts={lead.conflicts} score={leadScore.score} breakdown={leadScore.breakdown} />
        </div>
      </details>
      <details className="border-b border-zinc-200 bg-white px-3 py-2 text-sm">
        <summary className="cursor-pointer text-zinc-600">Bitácora ({audit?.length ?? 0})</summary>
        <ol className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
          {(audit ?? []).map((a) => (
            <li key={a.id} className="flex gap-2">
              <span className="shrink-0 text-zinc-400">{timeShort(a.created_at)}</span>
              <span className={EVENT_CLS[a.event] ?? "text-zinc-700"}>{a.summary}</span>
              {auditDetail(a.event, a.details) && <span className="text-zinc-400">· {auditDetail(a.event, a.details)}</span>}
            </li>
          ))}
        </ol>
      </details>
      <ol className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m) => {
          const mine = m.author !== "client";
          const out = m.outbound_messages?.[0];
          const url = m.media_path ? urls.get(m.media_path) : undefined;
          return (
            <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.author === "client" ? "bg-white" : m.author === "ai" ? "bg-emerald-50" : m.author === "system" ? "bg-zinc-100 italic" : "bg-blue-50"}`}>
                {m.author !== "client" && <div className="mb-0.5 text-[11px] font-medium text-zinc-500">{m.author === "ai" ? "Bot" : m.author === "human" ? "Equipo" : "Sistema"}</div>}
                {m.kind === "audio" && (url ? <audio controls preload="none" src={url} className="max-w-full" /> : <span className="text-zinc-500">{KIND_LABEL.audio} (no disponible)</span>)}
                {/* eslint-disable-next-line @next/next/no-img-element -- link firmado que vence: no pasa por el optimizador */}
                {m.kind === "image" && (url ? <a href={url} target="_blank"><img src={url} alt="Imagen del cliente" className="max-h-64 rounded" /></a> : <span className="text-zinc-500">{KIND_LABEL.image} (no disponible)</span>)}
                {m.kind !== "text" && m.kind !== "audio" && m.kind !== "image" && <div className="text-zinc-500">{KIND_LABEL[m.kind] ?? m.kind}</div>}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.transcript && <p className="mt-1 border-t border-zinc-200 pt-1 text-xs text-zinc-600">Transcripción: {m.transcript}</p>}
                <div className="mt-1 flex justify-end gap-2 text-[11px] text-zinc-400">
                  {out && <span className={out.status === "failed" ? "text-red-600" : ""} title={out.error ?? undefined}>{STATUS_LABEL[out.status] ?? out.status}</span>}
                  {out?.status === "failed" && (!windowClosed || !!out.template) && <RetryButton conversationId={conv.id} outboundId={out.id} />}
                  <span>{timeShort(m.created_at)}</span>
                </div>
              </div>
            </li>
          );
        })}
        {messages.length === 0 && <li className="text-center text-sm text-zinc-500">Sin mensajes.</li>}
      </ol>
      <Composer conversationId={conv.id} mode={conv.mode} online={online} windowClosed={windowClosed} suggestion={suggestion} />
    </div>
  );
}

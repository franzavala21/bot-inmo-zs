import Link from "next/link";
import { notFound } from "next/navigation";
import { adminClient } from "@inmo/core";
import { serverClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { contactLabel, KIND_LABEL, phonePretty, timeShort } from "@/lib/format";
import { Composer } from "./composer";
import { ModeToggle } from "./mode-toggle";

type Msg = {
  id: string; author: "client" | "ai" | "human" | "system"; kind: string; body: string | null; media_path: string | null;
  transcript: string | null; created_at: string; outbound_messages: { status: string; error: string | null }[];
};

const STATUS_LABEL: Record<string, string> = { pending: "En cola", sending: "Enviando…", sent: "Enviado", failed: "No salió" };

export default async function Chat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await serverClient();
  const [{ data: conv }, { data: msgs }] = await Promise.all([
    sb.from("conversations").select("id, mode, needs_attention, attention_reason, channel_id, contact:contacts(phone, name, display_name, is_test)").eq("id", id).maybeSingle(),
    sb.from("messages").select("id, author, kind, body, media_path, transcript, created_at, outbound_messages(status, error)")
      .eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
  ]);
  if (!conv) notFound();
  const { data: channel } = await sb.from("channels").select("worker_status, worker_heartbeat_at").eq("id", conv.channel_id).maybeSingle();
  const online = channel?.worker_status === "online" &&
    !!channel.worker_heartbeat_at && Date.now() - new Date(channel.worker_heartbeat_at).getTime() < 120_000;

  const messages = ((msgs ?? []) as unknown as Msg[]).reverse();
  // Bucket privado: links firmados de corta duración para escuchar audios y ver imágenes.
  const paths = messages.map((m) => m.media_path).filter((p): p is string => !!p);
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await adminClient().storage.from("media").createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const contact = conv.contact as unknown as { phone: string; name: string | null; display_name: string | null; is_test: boolean } | null;

  return (
    <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-3xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 md:h-[calc(100vh-3rem)]">
      <RealtimeRefresh tables={["messages", "conversations", "outbound_messages"]} />
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white p-3">
        <div className="min-w-0">
          <Link href="/bandeja" className="text-sm text-zinc-500">← Bandeja</Link>
          <div className="truncate font-semibold">{contact ? contactLabel(contact) : "?"}</div>
          <div className="text-xs text-zinc-500">{contact ? phonePretty(contact.phone) : ""}{contact?.is_test ? " · prueba" : ""}</div>
        </div>
        <ModeToggle conversationId={conv.id} mode={conv.mode} />
      </header>
      {conv.needs_attention && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{conv.attention_reason ?? "Necesita atención"}</div>
      )}
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
                  <span>{timeShort(m.created_at)}</span>
                </div>
              </div>
            </li>
          );
        })}
        {messages.length === 0 && <li className="text-center text-sm text-zinc-500">Sin mensajes.</li>}
      </ol>
      <Composer conversationId={conv.id} mode={conv.mode} online={online} />
    </div>
  );
}

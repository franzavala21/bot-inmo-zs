"use client";
import { useRef, useState, useTransition } from "react";
import { sendReply } from "../actions";

export function Composer({ conversationId, mode, online, windowClosed = false, suggestion = null, phone = null }: { conversationId: string; mode: "ai" | "human"; online: boolean; windowClosed?: boolean; suggestion?: string | null; phone?: string | null }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!text.trim() || pending) return;
    setError(null);
    start(async () => {
      const r = await sendReply(conversationId, text);
      if (r.ok) { setText(""); ref.current?.focus(); } else setError(r.error ?? "Error");
    });
  };

  if (windowClosed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-amber-50/60 p-3 text-sm text-amber-900">
        <p className="min-w-0 flex-1">
          Pasaron más de 24 h desde el último mensaje del cliente: desde el número del bot solo salen plantillas aprobadas por Meta
          (Avisos y Consultas). Si querés contestarle ya, escribile desde tu WhatsApp.
        </p>
        {phone && (
          <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
            className="shrink-0 rounded-lg border border-emerald-600 bg-white px-3 py-1.5 font-medium text-emerald-800 hover:bg-emerald-50">
            Escribirle desde mi WhatsApp
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1 border-t border-zinc-200 bg-white p-3">
      {suggestion && !text && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm">
          <div className="text-xs font-medium text-emerald-800">El bot no le respondió. Esto es lo que sugería decirle (revisalo antes de mandar):</div>
          <p className="mt-1 whitespace-pre-wrap text-zinc-700">{suggestion}</p>
          <button onClick={() => { setText(suggestion); ref.current?.focus(); }} className="mt-1 text-xs text-emerald-800 underline">Usar como borrador</button>
        </div>
      )}
      {mode === "ai" && <p className="text-xs text-zinc-500">Si respondés, el chat pasa a modo humano y el bot deja de contestar acá.</p>}
      {!online && <p className="text-xs text-amber-700">WhatsApp está desconectado: el mensaje queda en cola y sale cuando se reconecte.</p>}
      <div className="flex gap-2">
        <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          placeholder="Escribí tu respuesta…" className="min-w-0 flex-1 resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm" />
        <button onClick={submit} disabled={pending || !text.trim()}
          className="self-end rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40">{pending ? "Enviando…" : "Enviar"}</button>
      </div>
      <p className="text-xs text-zinc-400">Ctrl/⌘ + Enter para enviar.</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

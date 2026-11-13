"use client";
import { useState, useTransition } from "react";
import { approveDraft, discardDraft } from "./actions";

/** Un aviso: se lee, se edita si sale como texto, y se aprueba o descarta. De a uno: no hay "aprobar todo". */
export function DraftActions({ draftId, body, mode }: { draftId: string; body: string; mode: "text" | "template" | "blocked" }) {
  const [text, setText] = useState(body);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {mode === "text" ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={1500}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm" />
      ) : (
        <p className="whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-sm text-zinc-700">{body}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {mode !== "blocked" && (
          <button disabled={pending || !text.trim()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={() => start(async () => {
              const r = await approveDraft(draftId, mode === "text" ? text : undefined);
              setMsg(r.ok ? (r.sent ? "Enviado" : "Aprobado: quedó en la cola (revisá el chat)") : r.error ?? "Error");
            })}>
            {pending ? "Enviando…" : "Aprobar y enviar"}
          </button>
        )}
        <button disabled={pending} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => start(async () => { const r = await discardDraft(draftId); setMsg(r.ok ? "Descartado" : r.error ?? "Error"); })}>
          Descartar
        </button>
        {msg && <span className="text-sm text-zinc-600">{msg}</span>}
      </div>
    </div>
  );
}

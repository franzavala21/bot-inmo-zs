"use client";
import { useState, useTransition } from "react";
import { decideConflict, refreshLead } from "./actions";

export function RefreshLeadButton({ conversationId, label = "Actualizar ficha" }: { conversationId: string; label?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={pending} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs disabled:opacity-40"
        onClick={() => start(async () => { const r = await refreshLead(conversationId); setError(r.ok ? null : r.error ?? "Error"); })}>
        {pending ? "Leyendo el chat…" : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function ConflictButtons({ contactId, conversationId, index }: { contactId: string; conversationId: string; index: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (accept: boolean) => start(async () => {
    const r = await decideConflict(contactId, conversationId, index, accept);
    setError(r.ok ? null : r.error ?? "Error");
  });
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={pending} onClick={() => run(true)} className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs disabled:opacity-40">Usar lo nuevo</button>
      <button disabled={pending} onClick={() => run(false)} className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs disabled:opacity-40">Dejar lo anterior</button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

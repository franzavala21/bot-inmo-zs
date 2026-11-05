"use client";
import { useState, useTransition } from "react";
import { saveBusinessInfo } from "./actions";

export function InfoForm({ infoKey, title, body }: { infoKey: string; title: string; body: string }) {
  const [text, setText] = useState(body);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = text.trim() !== body.trim();
  return (
    <form className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4"
      onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveBusinessInfo(infoKey, text); setMsg(r.ok ? "Guardado" : r.error ?? "Error"); }); }}>
      <label className="block font-medium" htmlFor={infoKey}>{title}</label>
      <textarea id={infoKey} value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} rows={3}
        placeholder="Vacío: el bot no dice nada de esto y lo deriva a una persona."
        className="w-full rounded-md border border-zinc-300 p-2 text-sm" />
      <div className="flex items-center justify-end gap-3">
        {msg && <span className="text-xs text-zinc-500">{msg}</span>}
        <button disabled={pending || !dirty} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

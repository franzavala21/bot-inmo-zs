"use client";
import { useRef, useState, useTransition } from "react";
import { addVisit, setVisitStatus } from "./actions";

export function VisitForm({ contacts, properties, defaultContact }: {
  contacts: { id: string; label: string }[]; properties: { id: string; label: string }[]; defaultContact?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-2"
      action={(fd) => start(async () => {
        const r = await addVisit(fd);
        setMsg(r.ok ? "Visita agendada" : r.error ?? "Error");
        if (r.ok) ref.current?.reset();
      })}>
      <label className="text-sm">Contacto
        <select name="contact_id" defaultValue={defaultContact ?? ""} className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5">
          <option value="">Elegí…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <label className="text-sm">Propiedad
        <select name="property_id" defaultValue="" className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5">
          <option value="">Sin propiedad</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className="text-sm">Día y hora (Córdoba)
        <input type="datetime-local" name="starts_at" required className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5" />
      </label>
      <label className="text-sm">Notas
        <input name="notes" maxLength={500} placeholder="Ej: llega con la familia" className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5" />
      </label>
      <div className="flex items-center gap-2 sm:col-span-2">
        <button disabled={pending} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">{pending ? "Guardando…" : "Agendar"}</button>
        {msg && <span className="text-sm text-zinc-600">{msg}</span>}
      </div>
    </form>
  );
}

const LABEL = { done: "Hecha", cancelled: "Cancelada", no_show: "No vino" } as const;
export function VisitStatusButtons({ visitId }: { visitId: string }) {
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex gap-1">
      {(Object.keys(LABEL) as (keyof typeof LABEL)[]).map((s) => (
        <button key={s} disabled={pending} onClick={() => start(async () => { await setVisitStatus(visitId, s); })}
          className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs disabled:opacity-40">{LABEL[s]}</button>
      ))}
    </span>
  );
}

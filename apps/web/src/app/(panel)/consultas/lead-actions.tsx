"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { contactPortalLead, dismissPortalLead, refreshPortalLeads } from "./actions";

export function RefreshButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button disabled={pending} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
        onClick={() => start(async () => { const r = await refreshPortalLeads(); setMsg(r.ok ? null : r.error ?? "Error"); })}>
        {pending ? "Trayendo de Tokko…" : "Actualizar"}
      </button>
      {msg && <span className="text-sm text-red-700">{msg}</span>}
    </span>
  );
}

/** Escribirle (plantilla de Meta, de a una) o descartar. */
export function LeadActions({ leadId, preview, blocked }: { leadId: string; preview: string; blocked: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [conv, setConv] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {!blocked && <p className="rounded-md bg-zinc-50 p-2 text-sm text-zinc-700">{preview}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {!blocked && (
          <button disabled={pending} className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={() => start(async () => {
              const r = await contactPortalLead(leadId);
              setMsg(r.ok ? (r.sent ? "Enviado" : "En cola: revisá el chat") : r.error ?? "Error");
              if (r.conversationId) setConv(r.conversationId);
            })}>
            {pending ? "Enviando…" : "Escribirle por WhatsApp"}
          </button>
        )}
        <button disabled={pending} className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => start(async () => { const r = await dismissPortalLead(leadId); setMsg(r.ok ? "Descartada" : r.error ?? "Error"); })}>
          Descartar
        </button>
        {blocked && <span className="text-sm text-zinc-500">{blocked}</span>}
        {msg && <span className="text-sm text-zinc-600">{msg}</span>}
        {conv && <Link href={`/bandeja/${conv}`} className="text-sm text-blue-700 underline">Abrir chat</Link>}
      </div>
    </div>
  );
}

/** Trae lo nuevo de Tokko en segundo plano y refresca la lista (la página ya se mostró con lo guardado). */
export function AutoSync() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "error" | "done">("loading");
  useEffect(() => {
    let alive = true;
    refreshPortalLeads().then((r) => { if (!alive) return; setState(r.ok ? "done" : "error"); if (r.ok) router.refresh(); });
    return () => { alive = false; };
  }, [router]);
  if (state === "done") return null;
  return <p className={`text-sm ${state === "error" ? "text-red-700" : "text-zinc-500"}`}>{state === "error" ? "No se pudo actualizar desde Tokko: se muestra lo último guardado." : "Buscando consultas nuevas en Tokko…"}</p>;
}

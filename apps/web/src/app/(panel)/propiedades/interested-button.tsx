"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { findInterested } from "./actions";

/** Busca leads a los que les sirve esta propiedad y deja avisos en borrador (no envía nada). */
export function InterestedButton({ propertyId }: { propertyId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="text-sm">
      <button disabled={pending} className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs disabled:opacity-40"
        onClick={() => start(async () => {
          const r = await findInterested(propertyId);
          setMsg(!r.ok ? r.error ?? "Error" : r.drafts ? `${r.drafts} aviso(s) nuevo(s) para revisar` :
            `Nadie nuevo${r.skipped ? ` (${r.skipped} coinciden pero no aceptaron avisos)` : ""}`);
        })}>
        {pending ? "Buscando…" : "Buscar interesados"}
      </button>
      {msg && <span className="ml-2 text-xs text-zinc-600">{msg} {msg.includes("revisar") && <Link href="/avisos" className="text-blue-700 underline">Ver</Link>}</span>}
    </div>
  );
}

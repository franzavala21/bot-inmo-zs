"use client";
import { useState, useTransition } from "react";
import { retryOutbound } from "../actions";

export function RetryButton({ conversationId, outboundId }: { conversationId: string; outboundId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button disabled={pending} className="text-blue-700 underline disabled:opacity-40"
        onClick={() => start(async () => { const r = await retryOutbound(conversationId, outboundId); setError(r.ok ? null : r.error ?? "Error"); })}>
        {pending ? "Reintentando…" : "Reintentar"}
      </button>
      {error && <span className="text-red-600" title={error}>· sigue sin salir</span>}
    </>
  );
}

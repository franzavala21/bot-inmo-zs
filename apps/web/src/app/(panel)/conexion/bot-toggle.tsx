"use client";
import { useTransition } from "react";
import { setBotEnabled } from "./actions";

export function BotToggle({ channelId, enabled }: { channelId: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const toggle = () => {
    const msg = enabled
      ? "¿Apagar el bot? Los mensajes nuevos van a quedar sin respuesta automática hasta que lo prendan."
      : "¿Prender el bot? Va a responder solo los chats que estén en modo IA.";
    if (confirm(msg)) start(() => setBotEnabled(channelId, !enabled));
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="text-sm">
        <div className="font-medium">Bot: {enabled ? <span className="text-emerald-700">prendido</span> : <span className="text-zinc-500">apagado</span>}</div>
        <div className="text-xs text-zinc-500">
          {enabled ? "Responde los chats en modo IA. Ante la duda, deriva a una persona." : "Nadie responde automáticamente. Los mensajes igual llegan a la bandeja."}
        </div>
      </div>
      <button disabled={pending} onClick={toggle}
        className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 ${enabled ? "border-zinc-300 bg-white" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
        {pending ? "…" : enabled ? "Apagar el bot" : "Prender el bot"}
      </button>
    </div>
  );
}

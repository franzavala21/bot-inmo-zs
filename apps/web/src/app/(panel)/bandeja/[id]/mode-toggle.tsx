"use client";
import { useTransition } from "react";
import { setMode } from "../actions";

export function ModeToggle({ conversationId, mode }: { conversationId: string; mode: "ai" | "human" }) {
  const [pending, start] = useTransition();
  const next = mode === "ai" ? "human" : "ai";
  return (
    <button disabled={pending} onClick={() => start(() => setMode(conversationId, next))}
      title={mode === "ai" ? "El bot deja de responder en este chat y lo seguís vos" : "El bot vuelve a responder en este chat"}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${mode === "human" ? "border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-800" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"}`}>
      {pending ? "…" : mode === "ai" ? "Tomar el chat" : "Devolver al bot"}
    </button>
  );
}

"use client";
import { useTransition } from "react";
import { setMode } from "../actions";

export function ModeToggle({ conversationId, mode }: { conversationId: string; mode: "ai" | "human" }) {
  const [pending, start] = useTransition();
  const next = mode === "ai" ? "human" : "ai";
  return (
    <button disabled={pending} onClick={() => start(() => setMode(conversationId, next))}
      className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 ${mode === "human" ? "border-blue-300 bg-blue-50 text-blue-800" : "border-zinc-300 bg-white"}`}>
      {pending ? "…" : mode === "ai" ? "Modo IA · Tomar el chat" : "Modo humano · Devolver al bot"}
    </button>
  );
}

"use client";
import { useEffect } from "react";

/** Al abrir un chat (y cuando llega un mensaje nuevo), baja hasta el último mensaje. */
export function ScrollToBottom({ targetId, count }: { targetId: string; count: number }) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (el) el.scrollTop = el.scrollHeight;
  }, [targetId, count]);
  return null;
}

"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/client";

/**
 * Escucha cambios en las tablas indicadas y recarga los datos del servidor.
 * Simple a propósito: los datos siempre vienen del servidor (con RLS), Realtime solo avisa que cambió algo.
 */
export function RealtimeRefresh({ tables, filter }: { tables: string[]; filter?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(",") + (filter ?? "");

  useEffect(() => {
    const sb = browserClient();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };
    let ch = sb.channel(`rt-${key}-${Math.random().toString(36).slice(2)}`);
    for (const table of tables) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, refresh);
    }
    ch.subscribe();
    // Respaldo por si Realtime se corta: refresco cada 30 s mientras la pestaña está visible.
    const iv = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 30_000);
    return () => { clearInterval(iv); if (timer.current) clearTimeout(timer.current); void sb.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}

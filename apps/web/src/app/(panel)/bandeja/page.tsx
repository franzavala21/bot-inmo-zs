import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { after } from "next/server";
import { adminClient, runFollowUps } from "@inmo/core";
import { ownerClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { contactLabel, KIND_LABEL, timeAgo } from "@/lib/format";
import { WorkerBadge } from "../conexion/worker-badge";
import { Avatar, EmptyState, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";

type Row = {
  id: string; mode: "ai" | "human"; needs_attention: boolean; attention_reason: string | null; last_message_at: string;
  contact: { phone: string; name: string | null; display_name: string | null; is_test: boolean } | null;
  messages: { author: string; kind: string; body: string | null; created_at: string }[];
};

export default async function Bandeja({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const { f = "", q: rawQ = "" } = await searchParams;
  const sb = await ownerClient();
  // Seguimientos en segundo plano (no frena la bandeja).
  after(() => runFollowUps(adminClient()).catch(() => null));
  let q = sb.from("conversations")
    .select("id, mode, needs_attention, attention_reason, last_message_at, contact:contacts(phone, name, display_name, is_test), messages(author, kind, body, created_at)")
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" })
    .limit(200);
  if (f === "atencion") q = q.eq("needs_attention", true);
  if (f === "humano") q = q.eq("mode", "human");
  const { data, error } = await q;
  const pending = (r: Row) => r.messages[0]?.author === "client";
  // Búsqueda por nombre o teléfono (sobre lo ya traído: son pocas conversaciones).
  const term = rawQ.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const all = (data ?? []) as unknown as Row[];
  const rows = (f === "sin-responder" ? all.filter((r) => pending(r) && !r.needs_attention) : all).filter((r) => {
    if (!term) return true;
    const hay = `${r.contact ? contactLabel(r.contact) : ""} ${r.contact?.phone ?? ""}`.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    return hay.includes(term) || hay.replace(/\D/g, "").includes(term.replace(/\D/g, "") || "~");
  });
  const FILTERS = [["", "Todas"], ["atencion", "Necesitan atención"], ["sin-responder", "Sin responder"], ["humano", "En modo humano"]];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <RealtimeRefresh tables={["conversations", "messages"]} />
      <PageHeader title="Bandeja" description="Todas las conversaciones de WhatsApp. Arriba, las más recientes." actions={<WorkerBadge />} />
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-2 text-sm">
          {FILTERS.map(([v, l]) => (
            <Link key={v} href={`/bandeja?${new URLSearchParams({ ...(v ? { f: v } : {}), ...(rawQ ? { q: rawQ } : {}) })}`}
              className={`rounded-full border px-3 py-1 ${f === v ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>{l}</Link>
          ))}
        </nav>
        <form className="ml-auto flex min-w-0 flex-1 items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 py-1.5 sm:max-w-xs">
          <Icon name="search" className="h-4 w-4 shrink-0 text-zinc-400" />
          {f && <input type="hidden" name="f" value={f} />}
          <input name="q" defaultValue={rawQ} placeholder="Buscar nombre o teléfono" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </form>
      </div>
      {error && <p className="text-sm text-red-700">No se pudo cargar la bandeja.</p>}
      {rows.length === 0 ? (
        <EmptyState title={term ? "No hay conversaciones que coincidan" : "No hay conversaciones"}>
          {term ? "Probá con otro nombre o parte del teléfono." : f ? "Nada con este filtro." : "Cuando alguien escriba al WhatsApp, aparece acá."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {rows.map((r) => {
            const last = r.messages[0];
            const preview = last ? (last.body || KIND_LABEL[last.kind] || "") : "";
            const name = r.contact ? contactLabel(r.contact) : "?";
            const waiting = pending(r) && !r.needs_attention;
            return (
              <li key={r.id}>
                <Link href={`/bandeja/${r.id}`} className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 ${r.needs_attention ? "bg-red-50/40" : ""}`}>
                  <div className="relative">
                    <Avatar name={name} />
                    {(r.needs_attention || waiting) && <span className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-white ${r.needs_attention ? "bg-red-500" : "bg-amber-400"}`} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`truncate ${waiting || r.needs_attention ? "font-semibold text-zinc-900" : "font-medium text-zinc-800"}`}>{name}</span>
                      <span className={`shrink-0 text-xs ${waiting ? "font-medium text-amber-700" : "text-zinc-400"}`}>{timeAgo(r.last_message_at)}</span>
                    </div>
                    <div className="truncate text-sm text-zinc-500">
                      {last && last.author !== "client" && <span className="text-zinc-400">{last.author === "ai" ? "Bot: " : last.author === "system" ? "Sistema: " : "Vos: "}</span>}
                      {preview}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {r.needs_attention && <Pill tone="red">{r.attention_reason ?? "Necesita atención"}</Pill>}
                      {waiting && <Pill tone="amber">Sin responder</Pill>}
                      <Pill tone={r.mode === "human" ? "blue" : "green"}>{r.mode === "human" ? "Humano" : "Bot"}</Pill>
                      {r.contact?.is_test && <Pill>prueba</Pill>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

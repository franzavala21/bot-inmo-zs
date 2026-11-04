import Link from "next/link";
import { serverClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { contactLabel, KIND_LABEL, timeAgo } from "@/lib/format";
import { WorkerBadge } from "../conexion/worker-badge";

type Row = {
  id: string; mode: "ai" | "human"; needs_attention: boolean; attention_reason: string | null; last_message_at: string;
  contact: { phone: string; name: string | null; display_name: string | null; is_test: boolean } | null;
  messages: { author: string; kind: string; body: string | null; created_at: string }[];
};

export default async function Bandeja({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { f = "" } = await searchParams;
  const sb = await serverClient();
  let q = sb.from("conversations")
    .select("id, mode, needs_attention, attention_reason, last_message_at, contact:contacts(phone, name, display_name, is_test), messages(author, kind, body, created_at)")
    .order("last_message_at", { ascending: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" })
    .limit(200);
  if (f === "atencion") q = q.eq("needs_attention", true);
  if (f === "humano") q = q.eq("mode", "human");
  const { data, error } = await q;
  const rows = (data ?? []) as unknown as Row[];

  const pending = (r: Row) => r.messages[0]?.author === "client";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <RealtimeRefresh tables={["conversations", "messages"]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Bandeja</h1>
        <WorkerBadge />
      </div>
      <nav className="flex gap-2 text-sm">
        {[["", "Todas"], ["atencion", "Necesitan atención"], ["humano", "En modo humano"]].map(([v, l]) => (
          <Link key={v} href={v ? `/bandeja?f=${v}` : "/bandeja"}
            className={`rounded-full border px-3 py-1 ${f === v ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white"}`}>{l}</Link>
        ))}
      </nav>
      {error && <p className="text-sm text-red-700">No se pudo cargar la bandeja.</p>}
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {rows.map((r) => {
          const last = r.messages[0];
          const preview = last ? (last.body || KIND_LABEL[last.kind] || "") : "";
          return (
            <li key={r.id}>
              <Link href={`/bandeja/${r.id}`} className="flex items-start gap-3 p-3 hover:bg-zinc-50">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${r.needs_attention ? "bg-red-500" : pending(r) ? "bg-amber-400" : "bg-transparent"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">
                      {r.contact ? contactLabel(r.contact) : "?"}
                      {r.contact?.is_test && <span className="ml-2 rounded bg-zinc-100 px-1.5 text-xs text-zinc-500">prueba</span>}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">{timeAgo(r.last_message_at)}</span>
                  </div>
                  <div className="truncate text-sm text-zinc-600">
                    {last && last.author !== "client" && <span className="text-zinc-400">{last.author === "ai" ? "Bot: " : "Vos: "}</span>}
                    {preview}
                  </div>
                  <div className="mt-1 flex gap-2 text-xs">
                    <span className={`rounded px-1.5 ${r.mode === "human" ? "bg-blue-50 text-blue-700" : "bg-zinc-100 text-zinc-600"}`}>
                      {r.mode === "human" ? "Humano" : "IA"}
                    </span>
                    {r.needs_attention && <span className="text-red-700">{r.attention_reason ?? "Necesita atención"}</span>}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && <li className="p-6 text-center text-sm text-zinc-500">No hay conversaciones{f ? " con este filtro" : " todavía"}.</li>}
      </ul>
    </div>
  );
}

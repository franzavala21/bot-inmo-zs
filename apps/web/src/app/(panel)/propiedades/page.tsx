import { searchProperties, parseRooms } from "@inmo/core";
import { serverClient } from "@/lib/supabase/server";
import { syncNow } from "./actions";

const fmt = (n: number | null, cur: string | null) =>
  n == null ? "Consultar" : `${cur ?? ""} ${n.toLocaleString("es-AR")}`;

export default async function Propiedades({ searchParams }: { searchParams: Promise<{ q?: string; op?: string }> }) {
  const { q = "", op = "" } = await searchParams;
  const sb = await serverClient();
  const items = await searchProperties(sb, {
    text: q || undefined,
    operation: op === "sale" || op === "rent" ? op : undefined,
    roomsMin: q ? parseRooms(q) : undefined,
    limit: 60,
  });
  const { data: lastRun } = await sb.from("tokko_sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Propiedades</h1>
        <form action={async () => { "use server"; await syncNow(); }}>
          <button className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50">Sincronizar con Tokko</button>
        </form>
      </div>
      <p className="text-sm text-zinc-500">
        {lastRun ? (lastRun.error ? `Última sincronización con error: ${lastRun.error}` :
          `Última sincronización: ${new Date(lastRun.started_at).toLocaleString("es-AR")} · ${lastRun.fetched ?? "…"} propiedades`) :
          "Todavía no se sincronizó."}
      </p>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Ej: depto 2 amb palermo" className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2" />
        <select name="op" defaultValue={op} className="rounded-md border border-zinc-300 px-2 py-2">
          <option value="">Todas</option><option value="sale">Venta</option><option value="rent">Alquiler</option>
        </select>
        <button className="rounded-md bg-zinc-900 px-4 py-2 text-white">Buscar</button>
      </form>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => (
          <li key={p.id} className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="text-xs text-zinc-500">{p.reference_code} · {p.property_type} · {p.operation === "rent" ? "Alquiler" : "Venta"}</div>
            <div className="font-medium">{p.title}</div>
            <div className="text-sm text-zinc-600">{p.zone}{p.rooms ? ` · ${p.rooms} amb` : ""}{p.surface_total ? ` · ${p.surface_total} m²` : ""}</div>
            <div className="mt-1 font-semibold">{fmt(p.price, p.currency)}</div>
            {p.public_url && <a href={p.public_url} target="_blank" className="text-sm text-blue-700 underline">Ver en la web</a>}
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className="text-zinc-500">Sin resultados.</p>}
    </div>
  );
}

import { PageHeader } from "@/components/page-header";
import { searchProperties, parseRooms } from "@inmo/core";
import { ownerClient } from "@/lib/supabase/server";
import { syncNow } from "./actions";
import { InterestedButton } from "./interested-button";
import { EmptyState, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";

const fmt = (n: number | null, cur: string | null) =>
  n == null ? "Consultar" : `${cur ?? ""} ${n.toLocaleString("es-AR")}`;

export default async function Propiedades({ searchParams }: { searchParams: Promise<{ q?: string; op?: string }> }) {
  const { q = "", op = "" } = await searchParams;
  const sb = await ownerClient();
  const items = await searchProperties(sb, {
    text: q || undefined,
    operation: op === "sale" || op === "rent" ? op : undefined,
    roomsMin: q ? parseRooms(q) : undefined,
    limit: 120,
  });
  const { data: lastRun } = await sb.from("tokko_sync_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle();

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Propiedades"
        description={lastRun ? (lastRun.error ? `Última sincronización con error: ${lastRun.error}` :
          `Desde Tokko. Última sincronización: ${new Date(lastRun.started_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Cordoba" })} · ${lastRun.fetched ?? "…"} propiedades`) :
          "Todavía no se sincronizó."}
        actions={<form action={async () => { "use server"; await syncNow(); }}>
          <button className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50">Sincronizar con Tokko</button>
        </form>} />
      <form className="flex flex-wrap gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-100">
          <Icon name="search" className="h-4 w-4 shrink-0 text-zinc-400" />
          <input name="q" defaultValue={q} placeholder="Ej: casa 3 dormitorios Salsipuedes, o un código" className="min-w-0 flex-1 bg-transparent py-2 outline-none" />
        </div>
        <select name="op" defaultValue={op} className="rounded-lg border border-zinc-300 bg-white px-2 py-2">
          <option value="">Venta y alquiler</option><option value="sale">Venta</option><option value="rent">Alquiler</option>
        </select>
        <button className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800">Buscar</button>
      </form>
      <p className="text-sm text-zinc-500">{items.length} propiedad{items.length === 1 ? "" : "es"}{q ? ` para «${q}»` : ""}</p>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => {
          const link = p.web_url || p.public_url;
          const facts = [p.bedrooms ? `${p.bedrooms} dorm.` : null, p.bathrooms ? `${p.bathrooms} baño${p.bathrooms > 1 ? "s" : ""}` : null,
            p.surface_covered ? `${p.surface_covered} m² cub.` : null, p.surface_total ? `${p.surface_total} m² lote` : null].filter(Boolean);
          return (
            <li key={p.id} className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <a href={link ?? undefined} target="_blank" className="relative block aspect-[16/10] bg-zinc-100">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto de Tokko (dominio externo), sin optimizador */}
                {p.photo_url && <img src={p.photo_url} alt={p.title ?? "Propiedad"} loading="lazy" className="h-full w-full object-cover" />}
                <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow ${p.operation === "rent" ? "bg-sky-600 text-white" : "bg-emerald-700 text-white"}`}>
                  {p.operation === "rent" ? "Alquiler" : "Venta"}
                </span>
              </a>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold tabular-nums">{fmt(p.price, p.currency)}</span>
                  <span className="text-xs text-zinc-400">{p.reference_code}</span>
                </div>
                <div className="text-sm font-medium text-zinc-800">{p.property_type} en {p.zone}</div>
                <div className="line-clamp-2 text-sm text-zinc-500">{p.title}</div>
                {facts.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{facts.map((f) => <Pill key={f}>{f}</Pill>)}</div>}
                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                  {link && <a href={link} target="_blank" className="text-sm font-medium text-emerald-700 hover:underline">Ver en la web</a>}
                  {p.operation === "sale" && <InterestedButton propertyId={p.id} />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length === 0 && <EmptyState title="No hay propiedades con esa búsqueda">Probá con menos palabras o sacá el filtro de operación.</EmptyState>}
    </div>
  );
}

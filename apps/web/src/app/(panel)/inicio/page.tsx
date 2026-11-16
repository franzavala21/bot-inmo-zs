import Link from "next/link";
import { ownerClient } from "@/lib/supabase/server";
import { contactLabel, longDay, timeAgo } from "@/lib/format";
import { Avatar, Panel, Pill, StatCard } from "@/components/ui";

// Inicio: lo que hay que hacer hoy, de un vistazo. Cada bloque lleva a su pantalla.
export const dynamic = "force-dynamic";

type C = { phone: string; name: string | null; display_name: string | null };
const TZ = "America/Argentina/Cordoba";

/** Inicio y fin del día de hoy en Córdoba (UTC-3, sin horario de verano). */
function todayBounds(now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  const start = new Date(`${ymd}T00:00:00-03:00`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400_000).toISOString() };
}

export default async function Inicio() {
  const sb = await ownerClient();
  const { start, end } = todayBounds();
  const [attention, recent, portal, portalCount, drafts, visits, top] = await Promise.all([
    sb.from("conversations").select("id, attention_reason, last_message_at, contact:contacts(phone, name, display_name)", { count: "exact" })
      .eq("needs_attention", true).order("last_message_at", { ascending: false }).limit(5),
    sb.from("conversations").select("id, mode, needs_attention, last_message_at, contact:contacts(phone, name, display_name), messages(author, created_at)")
      .order("last_message_at", { ascending: false }).order("created_at", { referencedTable: "messages", ascending: false })
      .limit(1, { referencedTable: "messages" }).limit(100),
    sb.from("portal_leads").select("id, name, origin, operation, property_type, zones, tokko_created_at").eq("status", "new")
      .order("tokko_created_at", { ascending: false }).limit(5),
    sb.from("portal_leads").select("id", { count: "exact", head: true }).eq("status", "new"),
    sb.from("outbound_drafts").select("kind").eq("status", "pending"),
    sb.from("visits").select("id, starts_at, status, contact:contacts(phone, name, display_name), property:properties(reference_code, zone)")
      .gte("starts_at", start).lt("starts_at", end).order("starts_at"),
    sb.from("lead_scores").select("score, contact:contacts(phone, name, display_name, conversations(id))").order("score", { ascending: false }).limit(5),
  ]);

  // Sin responder: el último mensaje es del cliente, hace más de 10 minutos (el bot ya habría contestado), y no está derivado.
  const now = Date.now();
  const unanswered = (recent.data ?? []).filter((c) => {
    const m = (c.messages as { author: string; created_at: string }[])[0];
    return m?.author === "client" && !c.needs_attention && now - Date.parse(m.created_at) > 10 * 60_000;
  });
  const pendingDrafts = drafts.data ?? [];
  const followUps = pendingDrafts.filter((d) => String(d.kind).startsWith("follow_up")).length;
  const when = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  const today = longDay(new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-sm text-zinc-500">{today}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Hola! Esto es lo que hay para hoy</h1>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard href="/bandeja?f=atencion" label="Necesitan atención" value={attention.count ?? 0} icon="inbox" tone="red" hint="El bot los pasó a ustedes" />
        <StatCard href="/bandeja" label="Sin responder" value={unanswered.length} icon="chat" tone="amber" hint="El cliente escribió último" />
        <StatCard href="/consultas" label="Consultas nuevas" value={portalCount.count ?? 0} icon="globe" tone="amber" hint="Zonaprop, Mercadolibre, web" />
        <StatCard href="/avisos" label="Avisos por aprobar" value={pendingDrafts.length} icon="bell" tone="green" hint={followUps ? `${followUps} de seguimiento` : "Propiedades nuevas"} />
        <StatCard href="/agenda" label="Visitas hoy" value={(visits.data ?? []).length} icon="calendar" tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Necesitan atención" href="/bandeja?f=atencion" empty={!(attention.data ?? []).length && "Nada pendiente: el bot se está arreglando solo."}>
          <ul className="divide-y divide-zinc-100">
            {(attention.data ?? []).map((c) => {
              const ct = c.contact as unknown as C;
              return (
                <li key={c.id}>
                  <Link href={`/bandeja/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                    <Avatar name={contactLabel(ct)} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{contactLabel(ct)}</div>
                      <div className="truncate text-xs text-red-700">{c.attention_reason ?? "Necesita atención"}</div>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-400">{timeAgo(c.last_message_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Consultas nuevas de portales" href="/consultas" empty={!(portal.data ?? []).length && "No hay consultas sin contestar."}>
          <ul className="divide-y divide-zinc-100">
            {(portal.data ?? []).map((l) => (
              <li key={l.id}>
                <Link href="/consultas" className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                  <Avatar name={l.name ?? "?"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.name ?? "Sin nombre"}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {[l.operation === "rent" ? "Alquiler" : l.operation === "sale" ? "Compra" : null, l.property_type, ((l.zones ?? []) as string[])[0]].filter(Boolean).join(" · ") || "Sin datos"}
                    </div>
                  </div>
                  {l.origin && <Pill tone={l.origin === "Zonaprop" ? "amber" : l.origin === "Mercadolibre" ? "blue" : "zinc"}>{l.origin}</Pill>}
                  <span className="shrink-0 text-xs text-zinc-400">{timeAgo(l.tokko_created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="A quién llamar" href="/leads" empty={!(top.data ?? []).length && "Todavía no hay fichas con puntaje."}>
          <ul className="divide-y divide-zinc-100">
            {(top.data ?? []).map((s, i) => {
              const ct = s.contact as unknown as C & { conversations: { id: string }[] };
              return (
                <li key={i}>
                  <Link href={ct?.conversations?.[0] ? `/bandeja/${ct.conversations[0].id}` : "/leads"} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                    <span className={`grid h-8 w-10 shrink-0 place-items-center rounded-lg text-sm font-semibold ${s.score >= 60 ? "bg-emerald-600 text-white" : s.score >= 30 ? "bg-emerald-100 text-emerald-900" : "bg-zinc-100 text-zinc-600"}`}>{s.score}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{ct ? contactLabel(ct) : "?"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Visitas de hoy" href="/agenda" empty={!(visits.data ?? []).length && "No hay visitas agendadas para hoy."}>
          <ul className="divide-y divide-zinc-100">
            {(visits.data ?? []).map((v) => {
              const ct = v.contact as unknown as C;
              const p = v.property as unknown as { reference_code: string | null; zone: string | null } | null;
              return (
                <li key={v.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-emerald-700">{when(v.starts_at)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{ct ? contactLabel(ct) : "?"}</div>
                    <div className="truncate text-xs text-zinc-500">{p ? `${p.reference_code} · ${p.zone ?? ""}` : "Sin propiedad"}</div>
                  </div>
                  {v.status !== "scheduled" && <Pill tone={v.status === "done" ? "green" : "zinc"}>{v.status === "done" ? "Hecha" : v.status === "cancelled" ? "Cancelada" : "No vino"}</Pill>}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

import Link from "next/link";
import { serverClient } from "@/lib/supabase/server";
import { contactLabel } from "@/lib/format";
import { VisitForm, VisitStatusButtons } from "./visit-form";

// Agenda interna de visitas. La cargan los dueños; el bot nunca confirma visitas.
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Agendada", cls: "text-blue-700" }, done: { label: "Hecha", cls: "text-emerald-700" },
  cancelled: { label: "Cancelada", cls: "text-zinc-500" }, no_show: { label: "No vino", cls: "text-red-700" },
};
const when = (iso: string) => new Date(iso).toLocaleString("es-AR", {
  timeZone: "America/Argentina/Cordoba", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});
type C = { id: string; name: string | null; display_name: string | null; phone: string };

export default async function Agenda({ searchParams }: { searchParams: Promise<{ contacto?: string }> }) {
  const { contacto } = await searchParams;
  const sb = await serverClient();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: visits }, { data: contacts }, { data: props }] = await Promise.all([
    sb.from("visits").select("id, starts_at, status, notes, contact:contacts(id, name, display_name, phone, conversations(id)), property:properties(reference_code, title, zone)")
      .gte("starts_at", since).order("starts_at"),
    sb.from("contacts").select("id, name, display_name, phone, is_test").order("created_at", { ascending: false }).limit(300),
    sb.from("properties_public").select("id, reference_code, property_type, zone").eq("operation", "sale").order("reference_code"),
  ]);
  const now = Date.now();
  const upcoming = (visits ?? []).filter((v) => new Date(v.starts_at).getTime() >= now - 3600_000);
  const past = (visits ?? []).filter((v) => new Date(v.starts_at).getTime() < now - 3600_000).reverse();

  const row = (v: NonNullable<typeof visits>[number]) => {
    const c = v.contact as unknown as C & { conversations: { id: string }[] };
    const p = v.property as unknown as { reference_code: string | null; title: string | null; zone: string | null } | null;
    const st = STATUS[v.status] ?? STATUS.scheduled;
    return (
      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <div className="min-w-0">
          <div className="font-medium">{when(v.starts_at)} · {c ? contactLabel(c) : "?"}</div>
          <div className="text-zinc-600">{p ? `${p.reference_code} · ${p.zone ?? ""}` : "Sin propiedad"}{v.notes ? ` · ${v.notes}` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={st.cls}>{st.label}</span>
          {v.status === "scheduled" && <VisitStatusButtons visitId={v.id} />}
          {c?.conversations?.[0] && <Link href={`/bandeja/${c.conversations[0].id}`} className="text-blue-700 underline">Chat</Link>}
        </div>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Agenda de visitas</h1>
        <p className="text-sm text-zinc-500">La cargan ustedes. El bot nunca confirma visitas: cuando alguien pide visitar, pasa el chat a una persona.</p>
      </header>
      <VisitForm defaultContact={contacto}
        contacts={(contacts ?? []).map((c) => ({ id: c.id, label: `${contactLabel(c)}${c.is_test ? " (prueba)" : ""}` }))}
        properties={(props ?? []).map((p) => ({ id: p.id, label: `${p.reference_code} · ${p.property_type} · ${p.zone ?? ""}` }))} />
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-600">Próximas</h2>
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">
          {upcoming.map(row)}
          {upcoming.length === 0 && <li className="p-3 text-sm text-zinc-500">No hay visitas agendadas.</li>}
        </ul>
      </section>
      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-600">Últimos 7 días</h2>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white">{past.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

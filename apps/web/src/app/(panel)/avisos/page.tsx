import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { PROPERTY_TEMPLATE, PUBLIC_COLUMNS, renderTemplate, SERVICE_WINDOW_MS, templateParams, type PublicRow } from "@inmo/core";
import { ownerClient } from "@/lib/supabase/server";
import { contactLabel, timeAgo } from "@/lib/format";
import { DraftActions } from "./draft-card";

// Avisos de propiedades nuevas para interesados. Los arma el matcher (código); un dueño los aprueba DE A UNO.
export const dynamic = "force-dynamic";

type Contact = { name: string | null; display_name: string | null; phone: string; is_test: boolean; proactive_opt_out: boolean };

export default async function Avisos() {
  const sb = await ownerClient();
  const { data: drafts } = await sb.from("outbound_drafts")
    .select("id, body, status, created_at, decided_at, contact_id, conversation_id, property_id, match:property_matches(reasons), contact:contacts(name, display_name, phone, is_test, proactive_opt_out)")
    .order("created_at", { ascending: false }).limit(100);
  const rows = drafts ?? [];
  const pending = rows.filter((d) => d.status === "pending");
  const decided = rows.filter((d) => d.status !== "pending").slice(0, 15);

  const contactIds = [...new Set(pending.map((d) => d.contact_id))];
  const propIds = [...new Set(pending.map((d) => d.property_id).filter(Boolean))] as string[];
  const [{ data: leads }, { data: scores }, { data: props }] = await Promise.all([
    sb.from("lead_profiles").select("contact_id, last_message_at, wants_alerts").in("contact_id", contactIds.length ? contactIds : ["-"]),
    sb.from("lead_scores").select("contact_id, score").in("contact_id", contactIds.length ? contactIds : ["-"]),
    sb.from("properties_public").select(PUBLIC_COLUMNS).in("id", propIds.length ? propIds : ["00000000-0000-0000-0000-000000000000"]),
  ]);
  const leadBy = new Map((leads ?? []).map((l) => [l.contact_id, l]));
  const scoreBy = new Map((scores ?? []).map((s) => [s.contact_id, s.score as number]));
  const propBy = new Map(((props ?? []) as unknown as PublicRow[]).map((p) => [p.id, p]));
  const now = Date.now();

  const items = pending.map((d) => {
    const lead = leadBy.get(d.contact_id);
    const inWindow = !!lead?.last_message_at && now - new Date(lead.last_message_at).getTime() < SERVICE_WINDOW_MS;
    const consent = (lead?.wants_alerts as { value?: boolean } | null)?.value === true;
    const prop = d.property_id ? propBy.get(d.property_id) : undefined;
    const contact = d.contact as unknown as Contact;
    const mode: "text" | "template" | "blocked" = !prop || contact?.proactive_opt_out ? "blocked" : inWindow ? "text" : consent ? "template" : "blocked";
    const why = !prop ? "La propiedad ya no está disponible" : contact?.proactive_opt_out ? "Pidió no recibir avisos"
      : mode === "blocked" ? "Pasaron 24 h y no aceptó recibir avisos: no se le puede escribir" : null;
    return { d, prop, contact, mode, why, score: scoreBy.get(d.contact_id) ?? 0,
      body: mode === "template" && prop ? renderTemplate(templateParams(prop)) : d.body,
      reasons: ((d.match as unknown as { reasons: string[] } | null)?.reasons ?? []) };
  }).sort((a, b) => b.score - a.score);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Avisos" description={<>Cuando entra una propiedad que coincide con lo que alguien busca, queda acá un aviso. Nada sale sin que lo apruebes, de a uno.
          Dentro de las 24 h de su último mensaje sale como texto (lo podés editar); después, como la plantilla «{PROPERTY_TEMPLATE.name}» de Meta,
          solo a quien aceptó recibir avisos.</>} />

      <ol className="space-y-3">
        {items.map(({ d, prop, contact, mode, why, score, body, reasons }) => (
          <li key={d.id} className="space-y-2 rounded-xl border border-zinc-200 bg-white shadow-sm p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-medium">
                {contact ? contactLabel(contact) : "?"}
                {contact?.is_test && <span className="ml-2 rounded bg-zinc-100 px-1 text-xs text-zinc-500">prueba</span>}
                <span className="ml-2 text-sm font-normal text-zinc-500">puntaje {score}</span>
              </div>
              <Link href={`/bandeja/${d.conversation_id}`} className="text-sm text-blue-700 underline">Chat</Link>
            </div>
            <div className="text-sm text-zinc-600">
              {prop ? `${prop.reference_code} · ${prop.property_type} en ${prop.zone}` : "Propiedad no disponible"} · {timeAgo(d.created_at)}
            </div>
            <ul className="flex flex-wrap gap-1 text-xs">
              {reasons.map((r) => <li key={r} className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">{r}</li>)}
            </ul>
            <div className="text-xs">
              {mode === "text" && <span className="text-emerald-700">Sale como texto (escribió hace menos de 24 h)</span>}
              {mode === "template" && <span className="text-blue-700">Sale como plantilla de Meta (aceptó recibir avisos)</span>}
              {why && <span className="text-red-700">{why}</span>}
            </div>
            <DraftActions draftId={d.id} body={body} mode={mode} />
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-zinc-500">No hay avisos pendientes.</li>}
      </ol>

      {decided.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-600">Últimos decididos</h2>
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white shadow-sm text-sm">
            {decided.map((d) => (
              <li key={d.id} className="flex justify-between gap-2 p-2">
                <Link href={`/bandeja/${d.conversation_id}`} className="truncate">{contactLabel(d.contact as unknown as Contact)}</Link>
                <span className={d.status === "approved" || d.status === "sent" ? "text-emerald-700" : "text-zinc-500"}>
                  {d.status === "rejected" ? "Descartado" : "Aprobado"} · {timeAgo(d.decided_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

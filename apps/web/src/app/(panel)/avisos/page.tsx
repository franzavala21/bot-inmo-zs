import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import {
  adminClient, FOLLOW_UP_TEMPLATE, MetaClient, metaConfigFromEnv, PROPERTY_TEMPLATE, PUBLIC_COLUMNS, renderTemplate, runFollowUps,
  SERVICE_WINDOW_MS, TEMPLATE_STATUS_LABEL, templateParams, templateReady, type PublicRow,
} from "@inmo/core";
import { ownerClient } from "@/lib/supabase/server";
import { contactLabel, timeAgo } from "@/lib/format";
import { DraftActions } from "./draft-card";

// Avisos de propiedades nuevas (matcher) y seguimientos a quien dejó de responder. Los arma el código; un dueño los aprueba DE A UNO.
export const dynamic = "force-dynamic";

type Contact = { name: string | null; display_name: string | null; phone: string; is_test: boolean; proactive_opt_out: boolean };

export default async function Avisos() {
  const sb = await ownerClient();
  // Busca chats para retomar antes de listar (barato: solo mira los que están en la franja de 20 h o 3 días).
  await runFollowUps(adminClient()).catch((e) => console.error("[seguimiento] %s", (e as Error).message.slice(0, 120)));
  const { data: drafts } = await sb.from("outbound_drafts")
    .select("id, kind, body, status, created_at, decided_at, contact_id, conversation_id, property_id, match:property_matches(reasons), contact:contacts(name, display_name, phone, is_test, proactive_opt_out)")
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
  const cfg = metaConfigFromEnv();
  const client = cfg ? new MetaClient(cfg) : null;
  const [tpl, tplFollow] = await Promise.all([
    templateReady(client, PROPERTY_TEMPLATE.name, PROPERTY_TEMPLATE.language),
    templateReady(client, FOLLOW_UP_TEMPLATE.name, FOLLOW_UP_TEMPLATE.language),
  ]);
  const KIND_LABEL: Record<string, string> = { follow_up_1: "Seguimiento: no contestó en 20 h", follow_up_2: "Seguimiento: no contestó en 3 días" };

  const items = pending.map((d) => {
    const lead = leadBy.get(d.contact_id);
    const inWindow = !!lead?.last_message_at && now - new Date(lead.last_message_at).getTime() < SERVICE_WINDOW_MS;
    const consent = (lead?.wants_alerts as { value?: boolean } | null)?.value === true;
    const prop = d.property_id ? propBy.get(d.property_id) : undefined;
    const contact = d.contact as unknown as Contact;
    const isMatch = d.kind === "match";
    const t = d.kind === "follow_up_2" ? tplFollow : tpl;
    const mode: "text" | "template" | "blocked" = (isMatch && !prop) || contact?.proactive_opt_out ? "blocked"
      : inWindow ? "text" : d.kind === "follow_up_1" ? "blocked" : consent && t.ok ? "template" : "blocked";
    const why = isMatch && !prop ? "La propiedad ya no está disponible" : contact?.proactive_opt_out ? "Pidió no recibir avisos"
      : mode === "blocked" && d.kind === "follow_up_1" ? "Pasaron las 24 h: ya no sale como texto. Descartalo (a los 3 días aparece el de plantilla, si aceptó avisos)"
      : mode === "blocked" && consent ? `Pasaron 24 h y la plantilla está ${TEMPLATE_STATUS_LABEL[t.status] ?? t.status}: por ahora no se le puede escribir`
      : mode === "blocked" ? "Pasaron 24 h y no aceptó recibir avisos: no se le puede escribir" : null;
    return { d, prop, contact, mode, why, score: scoreBy.get(d.contact_id) ?? 0, label: KIND_LABEL[d.kind] ?? null,
      body: mode === "template" && isMatch && prop ? renderTemplate(templateParams(prop)) : d.body,
      reasons: ((d.match as unknown as { reasons: string[] } | null)?.reasons ?? []) };
  }).sort((a, b) => b.score - a.score);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Avisos" description={<>Propiedades nuevas para quien las buscaba y seguimientos a quien dejó de responder (a las 20 h y a los 3 días). Nada sale sin que lo apruebes, de a uno.
          Dentro de las 24 h de su último mensaje sale como texto (lo podés editar); después, como la plantilla «{PROPERTY_TEMPLATE.name}» de Meta,
          solo a quien aceptó recibir avisos.</>} />

      <ol className="space-y-3">
        {items.map(({ d, prop, contact, mode, why, score, body, reasons, label }) => (
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
              {label ? <span className="font-medium text-amber-800">{label}</span> : prop ? `${prop.reference_code} · ${prop.property_type} en ${prop.zone}` : "Propiedad no disponible"} · {timeAgo(d.created_at)}
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

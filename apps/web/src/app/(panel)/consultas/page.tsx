import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import {
  MetaClient, metaConfigFromEnv, PORTAL_PROPERTY_TEMPLATE, PORTAL_TEMPLATE, portalPropertyParams, portalTemplateParams, PUBLIC_COLUMNS,
  renderPortalPropertyTemplate, renderPortalTemplate, SERVICE_WINDOW_MS, TEMPLATE_STATUS_LABEL, templateReady, waMeLink, type PublicRow,
} from "@inmo/core";
import { ownerClient } from "@/lib/supabase/server";
import { phonePretty, timeAgo } from "@/lib/format";
import { AutoSync, LeadActions, RefreshButton } from "./lead-actions";
import { Avatar, Pill } from "@/components/ui";

// Consultas que entran a Tokko desde los portales. Se escriben de a una, con aprobación (plantilla de Meta).
export const dynamic = "force-dynamic";
const STALE_MS = 5 * 60_000;

const TABS = { new: "Nuevas", contacted: "Contactadas", dismissed: "Descartadas" } as const;

export default async function Consultas({ searchParams }: { searchParams: Promise<{ ver?: string; op?: string }> }) {
  const { ver, op: rawOp } = await searchParams;
  // Por defecto, venta (el canal del bot); los alquileres los atiende otra persona.
  const op = rawOp === "rent" || rawOp === "all" ? rawOp : "sale";
  const tab = (ver && ver in TABS ? ver : "new") as keyof typeof TABS;
  const sb = await ownerClient();

  // Si la última actualización tiene más de 5 minutos, se muestra lo guardado y se trae lo nuevo de Tokko en segundo plano.
  const { data: last } = await sb.from("portal_leads").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  const stale = !last || Date.now() - new Date(last.synced_at).getTime() > STALE_MS;

  const { data: leadsAll } = await sb.from("portal_leads")
    .select("id, source, name, phone, phone_raw, email, origin, operation, property_type, zones, tokko_status, tokko_created_at, status, conversation_id, decided_at, contact:contacts(proactive_opt_out)")
    .eq("status", tab).order("tokko_created_at", { ascending: false }).limit(150);
  const leads = (leadsAll ?? []).filter((l) => op === "all" || l.operation === op || (op === "sale" && !l.operation));
  const { data: counts } = await sb.from("portal_leads").select("status, operation");
  const inOp = (c: { operation: string | null }) => op === "all" || c.operation === op || (op === "sale" && !c.operation);
  const count = (s: string) => (counts ?? []).filter((c) => c.status === s && inOp(c)).length;

  // ¿Ya escribió al bot? Último mensaje del cliente en ese chat (para no mandarle plantilla si la charla está abierta).
  const convIds = leads.map((l) => l.conversation_id).filter(Boolean) as string[];
  const { data: lastMsgs } = convIds.length
    ? await sb.from("messages").select("conversation_id, created_at").in("conversation_id", convIds).eq("author", "client").order("created_at", { ascending: false })
    : { data: [] };
  // Propiedad consultada (de los emails "Nueva consulta" de Tokko), por teléfono o email.
  const phones = leads.map((l) => l.phone).filter(Boolean) as string[];
  const emails = leads.map((l) => l.email?.toLowerCase()).filter(Boolean) as string[];
  const [{ data: inqP }, { data: inqE }] = await Promise.all([
    phones.length ? sb.from("portal_inquiries").select("phone, email, property_codes, property_title, message, received_at").in("phone", phones) : Promise.resolve({ data: [] }),
    emails.length ? sb.from("portal_inquiries").select("phone, email, property_codes, property_title, message, received_at").in("email", emails) : Promise.resolve({ data: [] }),
  ]);
  type Inq = { phone: string | null; email: string | null; property_codes: string[]; property_title: string | null; message: string | null; received_at: string };
  const inquiries = [...((inqP ?? []) as Inq[]), ...((inqE ?? []) as Inq[])].sort((a, b) => b.received_at.localeCompare(a.received_at));
  const inquiryOf = (phone: string | null, email: string | null) =>
    inquiries.find((q) => (phone && q.phone === phone) || (email && q.email === email.toLowerCase()));
  const codes = [...new Set(inquiries.flatMap((q) => q.property_codes))];
  const { data: props } = codes.length
    ? await sb.from("properties_public").select(PUBLIC_COLUMNS).in("reference_code", codes)
    : { data: [] };
  const propBy = new Map(((props ?? []) as unknown as PublicRow[]).map((p) => [p.reference_code as string, p]));

  const cfg = metaConfigFromEnv();
  const client = cfg ? new MetaClient(cfg) : null;
  const [tpl, tplProp] = await Promise.all([
    templateReady(client, PORTAL_TEMPLATE.name, PORTAL_TEMPLATE.language),
    templateReady(client, PORTAL_PROPERTY_TEMPLATE.name, PORTAL_PROPERTY_TEMPLATE.language),
  ]);

  const lastClient = new Map<string, string>();
  for (const m of lastMsgs ?? []) if (!lastClient.has(m.conversation_id)) lastClient.set(m.conversation_id, m.created_at);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Consultas de portales" actions={<RefreshButton />}
        description={<>Lo que entra a Tokko (Zonaprop, Mercadolibre, web). Escribirle manda la plantilla «{PORTAL_TEMPLATE.name}» desde el número del bot;
          si responde, el bot sigue la charla y lo califica.</>} />
      {stale && <AutoSync />}
      {!tpl.ok && !tplProp.ok && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Las plantillas de Meta todavía no se pueden usar («{PORTAL_TEMPLATE.name}»: {TEMPLATE_STATUS_LABEL[tpl.status] ?? tpl.status};
          «{PORTAL_PROPERTY_TEMPLATE.name}»: {TEMPLATE_STATUS_LABEL[tplProp.status] ?? tplProp.status}). Mientras tanto, usá «Abrir en WhatsApp»:
          te abre tu WhatsApp con el mensaje y el link ya escritos.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-2 text-sm">
          {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
            <Link key={k} href={`/consultas?ver=${k}&op=${op}`} className={`rounded-full border px-3 py-1 ${tab === k ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
              {TABS[k]} ({count(k)})
            </Link>
          ))}
        </nav>
        <nav className="flex rounded-full border border-zinc-300 bg-white p-0.5 text-sm">
          {([["sale", "Venta"], ["rent", "Alquiler"], ["all", "Todas"]] as const).map(([v, l]) => (
            <Link key={v} href={`/consultas?ver=${tab}&op=${v}`} className={`rounded-full px-3 py-0.5 ${op === v ? "bg-zinc-900 text-white" : "text-zinc-600 hover:text-zinc-900"}`}>{l}</Link>
          ))}
        </nav>
      </div>

      <ol className="space-y-3">
        {leads.map((l) => {
          const zones = (l.zones ?? []) as string[];
          const lc = l.conversation_id ? lastClient.get(l.conversation_id) : undefined;
          const openChat = !!lc && Date.now() - new Date(lc).getTime() < SERVICE_WINDOW_MS;
          const opt = (l.contact as unknown as { proactive_opt_out: boolean } | null)?.proactive_opt_out;
          const inq = inquiryOf(l.phone, l.email);
          const prop = inq?.property_codes.map((c) => propBy.get(c)).find(Boolean);
          const zonesShown = prop?.zone ? [prop.zone] : zones;
          const link = prop ? prop.web_url || prop.public_url : null;
          const withProp = !!(prop && link);
          const message = withProp
            ? renderPortalPropertyTemplate(portalPropertyParams({ name: l.name, origin: l.origin }, prop!, link!))
            : renderPortalTemplate(portalTemplateParams({ name: l.name, origin: l.origin, zones: zonesShown }));
          const ready = withProp ? tplProp : tpl;
          const blocked = l.operation === "rent" ? "Alquiler: lo atiende otra persona"
            : !l.phone ? "Sin teléfono válido para WhatsApp"
            : opt ? "Pidió no recibir mensajes"
            : openChat ? "Ya escribió al bot hace menos de 24 h: respondele desde el chat"
            : !ready.ok ? `Plantilla ${TEMPLATE_STATUS_LABEL[ready.status] ?? ready.status}`
            : null;
          const what = [l.operation === "rent" ? "Alquiler" : l.operation === "sale" ? "Compra" : null, l.property_type, zones.join(", ")].filter(Boolean).join(" · ");
          return (
            <li key={l.id} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={l.name ?? "?"} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {l.name ?? "Sin nombre"}
                      {l.origin && <Pill tone={l.origin === "Zonaprop" ? "amber" : l.origin === "Mercadolibre" ? "blue" : "zinc"}>{l.origin}</Pill>}
                      {l.operation === "rent" && <Pill tone="violet">Alquiler</Pill>}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-zinc-500">{timeAgo(l.tokko_created_at)} · {l.source === "email" && !l.tokko_status ? "Aviso por email de Tokko" : `Tokko: ${l.tokko_status ?? "—"}`}</span>
              </div>
              <div className="text-sm text-zinc-600">{what || "Sin datos de lo que busca"}</div>
              {inq && (
                <div className="rounded-lg bg-emerald-50/60 p-2 text-sm">
                  <div className="text-emerald-900">
                    Consultó por <b>{inq.property_codes[0] ?? "una propiedad"}</b>{inq.property_title ? ` · ${inq.property_title}` : ""}
                    {prop?.price ? ` · ${prop.currency} ${Number(prop.price).toLocaleString("es-AR")}` : ""}
                    {(prop?.web_url || prop?.public_url) && <> · <a href={prop.web_url || prop.public_url!} target="_blank" className="underline">ver</a></>}
                    {inq.property_codes[0] && !prop && <span className="text-zinc-500"> (ya no está publicada)</span>}
                  </div>
                  {inq.message && <details className="mt-1 text-xs text-zinc-600"><summary className="cursor-pointer">Mensaje</summary><p className="mt-1 whitespace-pre-wrap">{inq.message}</p></details>}
                </div>
              )}
              <div className="text-xs text-zinc-500">
                {l.phone ? phonePretty(l.phone) : l.phone_raw ? `Teléfono no reconocido: ${l.phone_raw}` : "Sin teléfono"}
                {l.email ? ` · ${l.email}` : ""}
                {l.conversation_id && <> · <Link href={`/bandeja/${l.conversation_id}`} className="text-blue-700 underline">Ver chat</Link></>}
              </div>
              {tab === "new" && (
                <LeadActions leadId={l.id} blocked={blocked} preview={message}
                  waLink={l.phone && !opt && l.operation !== "rent" ? waMeLink(l.phone, message) : null} />
              )}
              {tab !== "new" && l.decided_at && <div className="text-xs text-zinc-500">{TABS[tab]} {timeAgo(l.decided_at)}</div>}
            </li>
          );
        })}
        {leads.length === 0 && <li className="text-sm text-zinc-500">No hay consultas {TABS[tab].toLowerCase()}.</li>}
      </ol>
    </div>
  );
}

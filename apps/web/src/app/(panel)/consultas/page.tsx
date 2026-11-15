import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { PORTAL_TEMPLATE, portalTemplateParams, renderPortalTemplate, SERVICE_WINDOW_MS } from "@inmo/core";
import { ownerClient } from "@/lib/supabase/server";
import { phonePretty, timeAgo } from "@/lib/format";
import { AutoSync, LeadActions, RefreshButton } from "./lead-actions";

// Consultas que entran a Tokko desde los portales. Se escriben de a una, con aprobación (plantilla de Meta).
export const dynamic = "force-dynamic";
const STALE_MS = 5 * 60_000;

const TABS = { new: "Nuevas", contacted: "Contactadas", dismissed: "Descartadas" } as const;
const ORIGIN_CLS: Record<string, string> = { Zonaprop: "bg-orange-50 text-orange-800", Mercadolibre: "bg-yellow-50 text-yellow-800" };

export default async function Consultas({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const tab = (ver && ver in TABS ? ver : "new") as keyof typeof TABS;
  const sb = await ownerClient();

  // Si la última actualización tiene más de 5 minutos, se muestra lo guardado y se trae lo nuevo de Tokko en segundo plano.
  const { data: last } = await sb.from("portal_leads").select("synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  const stale = !last || Date.now() - new Date(last.synced_at).getTime() > STALE_MS;

  const { data: leads } = await sb.from("portal_leads")
    .select("id, name, phone, phone_raw, email, origin, operation, property_type, zones, tokko_status, tokko_created_at, status, conversation_id, decided_at, contact:contacts(proactive_opt_out)")
    .eq("status", tab).order("tokko_created_at", { ascending: false }).limit(150);
  const { data: counts } = await sb.from("portal_leads").select("status");
  const count = (s: string) => (counts ?? []).filter((c) => c.status === s).length;

  // ¿Ya escribió al bot? Último mensaje del cliente en ese chat (para no mandarle plantilla si la charla está abierta).
  const convIds = (leads ?? []).map((l) => l.conversation_id).filter(Boolean) as string[];
  const { data: lastMsgs } = convIds.length
    ? await sb.from("messages").select("conversation_id, created_at").in("conversation_id", convIds).eq("author", "client").order("created_at", { ascending: false })
    : { data: [] };
  // Propiedad consultada (de los emails "Nueva consulta" de Tokko), por teléfono o email.
  const phones = (leads ?? []).map((l) => l.phone).filter(Boolean) as string[];
  const emails = (leads ?? []).map((l) => l.email?.toLowerCase()).filter(Boolean) as string[];
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
    ? await sb.from("properties_public").select("reference_code, zone, price, currency, web_url, public_url").in("reference_code", codes)
    : { data: [] };
  const propBy = new Map((props ?? []).map((p) => [p.reference_code as string, p]));

  const lastClient = new Map<string, string>();
  for (const m of lastMsgs ?? []) if (!lastClient.has(m.conversation_id)) lastClient.set(m.conversation_id, m.created_at);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Consultas de portales" actions={<RefreshButton />}
        description={<>Lo que entra a Tokko (Zonaprop, Mercadolibre, web). Escribirle manda la plantilla «{PORTAL_TEMPLATE.name}» desde el número del bot;
          si responde, el bot sigue la charla y lo califica.</>} />
      {stale && <AutoSync />}

      <nav className="flex gap-1 text-sm">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((k) => (
          <Link key={k} href={`/consultas?ver=${k}`} className={`rounded-full border px-3 py-1 ${tab === k ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
            {TABS[k]} ({count(k)})
          </Link>
        ))}
      </nav>

      <ol className="space-y-3">
        {(leads ?? []).map((l) => {
          const zones = (l.zones ?? []) as string[];
          const lc = l.conversation_id ? lastClient.get(l.conversation_id) : undefined;
          const openChat = !!lc && Date.now() - new Date(lc).getTime() < SERVICE_WINDOW_MS;
          const opt = (l.contact as unknown as { proactive_opt_out: boolean } | null)?.proactive_opt_out;
          const blocked = l.operation === "rent" ? "Alquiler: lo atiende otra persona"
            : !l.phone ? "Sin teléfono válido para WhatsApp"
            : opt ? "Pidió no recibir mensajes"
            : openChat ? "Ya escribió al bot hace menos de 24 h: respondele desde el chat"
            : null;
          const inq = inquiryOf(l.phone, l.email);
          const prop = inq?.property_codes.map((c) => propBy.get(c)).find(Boolean);
          const zonesShown = prop?.zone ? [prop.zone] : zones;
          const what = [l.operation === "rent" ? "Alquiler" : l.operation === "sale" ? "Compra" : null, l.property_type, zones.join(", ")].filter(Boolean).join(" · ");
          return (
            <li key={l.id} className="space-y-2 rounded-xl border border-zinc-200 bg-white shadow-sm p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium">
                  {l.name ?? "Sin nombre"}
                  {l.origin && <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${ORIGIN_CLS[l.origin] ?? "bg-zinc-100 text-zinc-600"}`}>{l.origin}</span>}
                </div>
                <span className="text-xs text-zinc-500">{timeAgo(l.tokko_created_at)} · Tokko: {l.tokko_status ?? "—"}</span>
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
                <LeadActions leadId={l.id} blocked={blocked}
                  preview={renderPortalTemplate(portalTemplateParams({ name: l.name, origin: l.origin, zones: zonesShown }))} />
              )}
              {tab !== "new" && l.decided_at && <div className="text-xs text-zinc-500">{TABS[tab]} {timeAgo(l.decided_at)}</div>}
            </li>
          );
        })}
        {(leads ?? []).length === 0 && <li className="text-sm text-zinc-500">No hay consultas {TABS[tab].toLowerCase()}.</li>}
      </ol>
    </div>
  );
}

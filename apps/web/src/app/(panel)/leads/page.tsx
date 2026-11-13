import Link from "next/link";
import { computeSignals, profileFromRow, publishedScoringRules, scoreLead } from "@inmo/core";
import { LeadCard } from "@/components/lead-card";
import { serverClient } from "@/lib/supabase/server";
import { contactLabel, phonePretty, timeAgo } from "@/lib/format";
import { showValue, windowInfo } from "@/lib/lead-format";
import { RefreshLeadButton } from "./lead-buttons";

// "A quién llamar": leads ordenados por puntaje. El puntaje se calcula acá con las reglas publicadas (código, sin modelo),
// así "escribió en las últimas 48 h" está siempre al día.
export const dynamic = "force-dynamic";

type Contact = { id: string; phone: string; name: string | null; display_name: string | null; is_test: boolean;
  conversations: { id: string; last_message_at: string | null; needs_attention: boolean; mode: "ai" | "human" }[] };

export default async function Leads() {
  const sb = await serverClient();
  const [{ data: rows }, { data: sig }, rules, { data: convs }] = await Promise.all([
    sb.from("lead_profiles").select("*, contact:contacts(id, phone, name, display_name, is_test, conversations(id, last_message_at, needs_attention, mode))"),
    sb.from("lead_signals").select("contact_id, signal"),
    publishedScoringRules(sb),
    sb.from("conversations").select("id, last_message_at, contact_id, contact:contacts(phone, name, display_name, is_test)")
      .order("last_message_at", { ascending: false }).limit(200),
  ]);

  const signalsBy = new Map<string, string[]>();
  for (const s of sig ?? []) signalsBy.set(s.contact_id, [...(signalsBy.get(s.contact_id) ?? []), s.signal]);
  const now = Date.now();

  const leads = (rows ?? []).map((r) => {
    const { profile, conflicts } = profileFromRow(r);
    const contact = r.contact as unknown as Contact;
    const conv = [...(contact?.conversations ?? [])].sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""))[0];
    const signals = computeSignals(signalsBy.get(r.contact_id) ?? [], r.last_message_at ? new Date(r.last_message_at) : null, now);
    return { contact, conv, profile, conflicts, lastClientAt: r.last_message_at as string | null, ...scoreLead(profile, signals, rules.rules) };
  }).filter((l) => l.contact && l.conv)
    .sort((a, b) => b.score - a.score || (b.lastClientAt ?? "").localeCompare(a.lastClientAt ?? ""));

  const withProfile = new Set((rows ?? []).map((r) => r.contact_id));
  const pending = (convs ?? []).filter((c) => !withProfile.has(c.contact_id)).slice(0, 20);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold">A quién llamar</h1>
        <p className="text-sm text-zinc-500">
          Ordenados por puntaje (reglas versión {rules.version}). Cada dato muestra la frase del cliente que lo respalda.
        </p>
      </header>

      <ol className="space-y-3">
        {leads.map((l) => {
          const w = windowInfo(l.lastClientAt);
          const summary = [l.profile.property_type, l.profile.zones, l.profile.budget_max]
            .map((e, i) => (e ? showValue((["property_type", "zones", "budget_max"] as const)[i], e.value, l.profile) : null)).filter(Boolean).join(" · ");
          return (
            <li key={l.contact.id} className="rounded-lg border border-zinc-200 bg-white">
              <details>
                <summary className="flex cursor-pointer items-start gap-3 p-3">
                  <span className={`mt-0.5 w-10 shrink-0 rounded text-center text-sm font-semibold ${l.score >= 60 ? "bg-emerald-600 text-white" : l.score >= 30 ? "bg-emerald-100 text-emerald-900" : "bg-zinc-100 text-zinc-600"}`}>{l.score}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {(l.profile.name?.value as string | undefined) ?? contactLabel(l.contact)}
                      {l.contact.is_test && <span className="ml-2 rounded bg-zinc-100 px-1 text-xs text-zinc-500">prueba</span>}
                      {l.conflicts.length > 0 && <span className="ml-2 rounded bg-amber-100 px-1 text-xs text-amber-800">revisar</span>}
                    </span>
                    <span className="block truncate text-sm text-zinc-600">{summary || "Todavía no dijo qué busca"}</span>
                    <span className="block text-xs text-zinc-400">
                      {phonePretty(l.contact.phone)} · escribió {timeAgo(l.lastClientAt)} · <span className={w.open ? "text-emerald-700" : "text-red-600"}>{w.label}</span>
                    </span>
                  </span>
                  <Link href={`/bandeja/${l.conv.id}`} className="shrink-0 text-sm text-blue-700 underline">Chat</Link>
                </summary>
                <div className="border-t border-zinc-100 p-3">
                  <LeadCard contactId={l.contact.id} conversationId={l.conv.id} profile={l.profile} conflicts={l.conflicts} score={l.score} breakdown={l.breakdown} />
                </div>
              </details>
            </li>
          );
        })}
        {leads.length === 0 && <li className="text-sm text-zinc-500">Todavía no hay fichas. Se arman solas cuando un cliente escribe.</li>}
      </ol>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-600">Chats sin ficha</h2>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
            {pending.map((c) => {
              const ct = c.contact as unknown as { phone: string; name: string | null; display_name: string | null; is_test: boolean };
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 p-2">
                  <Link href={`/bandeja/${c.id}`} className="truncate">{contactLabel(ct)}{ct.is_test ? " · prueba" : ""}</Link>
                  <RefreshLeadButton conversationId={c.id} label="Armar ficha" />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

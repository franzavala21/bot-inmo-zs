// Actualiza la ficha y el puntaje de un lead contra la base. Lo llaman los webhooks (después del turno del bot) y el panel.
// Privacidad: los logs llevan solo el id de conversación.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addUsage, emptyUsage, OpenAiLlm, type Llm, type Usage } from "../bot/llm";
import type { HistoryMsg } from "../bot/types";
import { extractLead, LEAD_FIELDS } from "./extract";
import { mergeProfile, type Conflict, type LeadField, type Profile } from "./profile";
import { computeSignals, scoreLead, type ScoringRule } from "./score";

export const FIELD_LABEL: Record<LeadField, string> = {
  operation: "operación", zones: "zona", property_type: "tipo", budget_max: "presupuesto", budget_currency: "moneda",
  rooms_min: "dormitorios", pets: "mascotas", timeframe: "plazo", financing: "forma de pago", name: "nombre", wants_visit: "visita",
};

export function profileFromRow(row: Record<string, unknown> | null): { profile: Profile; conflicts: Conflict[] } {
  const profile: Profile = {};
  for (const f of LEAD_FIELDS) profile[f] = (row?.[f] as Profile[LeadField]) ?? null;
  return { profile, conflicts: ((row?.conflicts as Conflict[] | null) ?? []) };
}

export async function publishedScoringRules(db: SupabaseClient): Promise<{ version: number; rules: ScoringRule[] }> {
  const { data } = await db.from("scoring_rules_versions").select("version, rules").eq("published", true)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return { version: data?.version ?? 0, rules: (data?.rules ?? []) as ScoringRule[] };
}

export type LeadResult = "updated" | "unchanged" | "stale" | "no_messages" | "limit" | "error";

export async function updateLead(
  db: SupabaseClient, conversationId: string,
  opts: { llm?: Llm; messageId?: string; force?: boolean; now?: () => number; spendCapUsd?: number } = {},
): Promise<LeadResult> {
  const now = opts.now ?? Date.now;
  let usage: Usage = emptyUsage();
  const log = (event: string, summary: string, details: Record<string, unknown> = {}) =>
    db.from("audit_log").insert({ conversation_id: conversationId, event, summary, details }).then(() => {}, () => {});
  try {
    const { data: conv } = await db.from("conversations").select("contact_id").eq("id", conversationId).maybeSingle();
    if (!conv) return "error";
    const contactId = conv.contact_id as string;

    const { data: rows } = await db.from("messages").select("id, author, kind, body, transcript, created_at")
      .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(40);
    const msgs = (rows ?? []).reverse();
    const lastClient = [...msgs].reverse().find((m) => m.author === "client");
    if (!lastClient) return "no_messages";
    // Ráfaga de mensajes: solo lee la ficha el turno del último.
    if (opts.messageId && lastClient.id !== opts.messageId) return "stale";

    const { data: row } = await db.from("lead_profiles").select("*").eq("contact_id", contactId).maybeSingle();
    if (!opts.force && row?.last_message_at && new Date(row.last_message_at as string) >= new Date(lastClient.created_at)) return "unchanged";

    const cap = opts.spendCapUsd ?? Number(process.env.DAILY_SPEND_CAP_USD ?? 5);
    const { data: today } = await db.from("usage_daily").select("cost_usd").eq("day", new Date(now()).toISOString().slice(0, 10)).maybeSingle();
    if (Number(today?.cost_usd ?? 0) >= cap) { await log("limit", "No se actualizó la ficha: tope de gasto del día"); return "limit"; }

    const history: HistoryMsg[] = msgs.map((m) => ({ author: m.author, kind: m.kind ?? "text", text: m.body ?? m.transcript ?? null, at: m.created_at }));
    const x = await extractLead(opts.llm ?? new OpenAiLlm(), history, new Date(now()));
    usage = addUsage(usage, x.usage);

    const old = profileFromRow(row);
    const at = new Date(now()).toISOString();
    const merged = mergeProfile(old.profile, old.conflicts, x.data, at);

    // Señales guardadas: pidió visitar (lo dijo el clasificador del bot o el extractor con su frase).
    const [{ data: visitByBot }, { data: stored }, rules] = await Promise.all([
      db.from("audit_log").select("id").eq("conversation_id", conversationId).eq("event", "classified")
        .eq("details->>reserved_topic", "visita").limit(1),
      db.from("lead_signals").select("signal").eq("contact_id", contactId),
      publishedScoringRules(db),
    ]);
    const newSignals = [...((visitByBot ?? []).length || merged.profile.wants_visit?.value === true ? ["wants_visit"] : [])];
    const signals = computeSignals([...(stored ?? []).map((s) => s.signal as string), ...newSignals], new Date(lastClient.created_at), now());
    const { score, breakdown } = scoreLead(merged.profile, signals, rules.rules);

    const newConflicts = merged.conflicts.length - old.conflicts.length;
    const parts = [
      merged.changed.length ? `nuevo: ${merged.changed.map((f) => FIELD_LABEL[f]).join(", ")}` : "sin datos nuevos",
      newConflicts > 0 ? `${newConflicts} contradicción(es) para revisar` : null,
      x.dropped.length ? `${x.dropped.length} dato(s) descartado(s) por no tener frase del cliente` : null,
    ].filter(Boolean);
    const { error } = await db.rpc("save_lead", {
      p_contact_id: contactId, p_conversation_id: conversationId, p_profile: merged.profile, p_conflicts: merged.conflicts,
      p_signals: newSignals, p_score: score, p_breakdown: breakdown, p_rules_version: rules.version,
      p_last_message_at: lastClient.created_at, p_summary: `Ficha del lead: ${parts.join("; ")} (puntaje ${score})`,
    });
    if (error) throw new Error(`save_lead: ${error.message}`);
    return "updated";
  } catch (e) {
    console.error("[lead] conv=%s falló: %s", conversationId, (e as Error).message.slice(0, 160));
    await log("agent_error", "No se pudo actualizar la ficha del lead", { error: (e as Error).message.slice(0, 200) });
    return "error";
  } finally {
    if (usage.costUsd > 0 || usage.inputTokens > 0) {
      await db.rpc("add_usage", { p_in: usage.inputTokens, p_out: usage.outputTokens, p_audio: 0, p_cost: usage.costUsd });
    }
  }
}

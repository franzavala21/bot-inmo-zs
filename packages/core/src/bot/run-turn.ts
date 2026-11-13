// Un turno del bot contra la base: lee, decide (orquestador) y escribe todo junto (bot_commit).
// Privacidad: los logs llevan solo el id de conversación.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_COLUMNS, searchProperties } from "../retrieval/search";
import { toFact, type PublicRow } from "./facts";
import { addUsage, emptyUsage, OpenAiLlm, type Llm, type Usage } from "./llm";
import { decide, PHRASES } from "./orchestrator";
import { clientFirstName } from "./name";
import { OpenAiTranscriber, type Transcriber } from "./transcribe";
import type { BusinessInfo, HistoryMsg, Rule, TraceEntry } from "./types";

export interface RunTurnOptions {
  llm?: Llm;
  transcriber?: Transcriber;
  /** Tope de gasto diario en USD (DAILY_SPEND_CAP_USD). */
  spendCapUsd?: number;
  /** Mensajes del bot por contacto por hora antes de pasar a una persona. */
  maxPerHour?: number;
  historyLimit?: number;
  /**
   * Derivación en silencio (decisión de los dueños, 2026-11-13): al derivar, el bot no le escribe al cliente.
   * El chat pasa a modo humano, se avisa a los dueños y lo que el bot iba a decir queda como respuesta sugerida.
   */
  silentHandoff?: boolean;
}

export type TurnResult = "skipped" | "ignored" | "sent" | "handoff" | "human" | "stale" | "error";

/** Derivación en silencio: el texto no se envía, queda en la bitácora como sugerencia para el dueño. */
export function silence<T extends { body: string | null; handoff: boolean; trace: TraceEntry[] }>(a: T): T {
  if (!a.handoff || !a.body?.trim()) return a;
  return { ...a, body: null, trace: [...a.trace, { event: "suggested", summary: "El bot no le respondió al cliente: pasó el chat a una persona y dejó una respuesta sugerida",
    details: { body: a.body } }] };
}

async function commit(db: SupabaseClient, conversationId: string, messageId: string, a0: {
  body: string | null; handoff: boolean; reason: string | null; trace: TraceEntry[]; codes?: string[];
}, silent = true): Promise<TurnResult> {
  const a = silent ? silence(a0) : a0;
  const { data, error } = await db.rpc("bot_commit", {
    p_conversation_id: conversationId, p_message_id: messageId, p_body: a.body, p_handoff: a.handoff,
    p_reason: a.reason, p_trace: a.trace, p_send_details: { property_codes: a.codes ?? [] },
  });
  if (error) throw new Error(`bot_commit: ${error.message}`);
  return data as TurnResult;
}

export async function runBotTurn(db: SupabaseClient, conversationId: string, messageId: string, opts: RunTurnOptions = {}): Promise<TurnResult> {
  const { data: claimed, error: claimErr } = await db.rpc("claim_bot_turn", { p_conversation_id: conversationId, p_message_id: messageId });
  if (claimErr) throw new Error(`claim_bot_turn: ${claimErr.message}`);
  if (!claimed) return "skipped";
  const silent = opts.silentHandoff ?? true;

  let usage: Usage = emptyUsage();
  try {
    const { data: conv, error: convErr } = await db.from("conversations")
      .select("contact_id, channel:channels(operation), contact:contacts(name, display_name)").eq("id", conversationId).single();
    if (convErr || !conv) throw new Error("conversación no encontrada");
    const channelOperation = ((conv.channel as unknown as { operation: "sale" | "rent" } | null)?.operation) ?? "sale";

    // ── Frenos: tope de gasto diario y mensajes por hora ──
    const cap = opts.spendCapUsd ?? Number(process.env.DAILY_SPEND_CAP_USD ?? 5);
    const { data: today } = await db.from("usage_daily").select("cost_usd").eq("day", new Date().toISOString().slice(0, 10)).maybeSingle();
    if (Number(today?.cost_usd ?? 0) >= cap) {
      return await commit(db, conversationId, messageId, { body: null, handoff: true,
        reason: "El bot llegó al tope de gasto del día", trace: [{ event: "limit", summary: `Tope diario de gasto alcanzado (USD ${cap})` }] }, silent);
    }
    const { data: count } = await db.rpc("bump_rate", { p_contact_id: conv.contact_id });
    if (Number(count) > (opts.maxPerHour ?? 20)) {
      return await commit(db, conversationId, messageId, { body: null, handoff: true,
        reason: "Demasiados mensajes en una hora", trace: [{ event: "limit", summary: "Límite de mensajes por hora de este contacto" }] }, silent);
    }

    // ── Historial (y transcripción de audios pendientes) ──
    const { data: rows } = await db.from("messages").select("id, author, kind, body, transcript, media_path, created_at")
      .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(opts.historyLimit ?? 20);
    const msgs = (rows ?? []).reverse();
    const trace: TraceEntry[] = [];
    let transcriber = opts.transcriber;
    for (const m of msgs) {
      if (m.author !== "client" || m.kind !== "audio" || m.transcript || !m.media_path) continue;
      try {
        transcriber ??= new OpenAiTranscriber();
        const t = await transcriber.transcribe(db, m.media_path);
        usage = addUsage(usage, t.usage);
        m.transcript = t.text;
        await db.from("messages").update({ transcript: t.text }).eq("id", m.id);
        trace.push({ event: "transcribed", summary: "Audio transcripto", details: { message_id: m.id, seconds: t.usage.audioSeconds } });
      } catch (e) {
        trace.push({ event: "agent_error", summary: "No se pudo transcribir un audio", details: { message_id: m.id, error: (e as Error).message.slice(0, 200) } });
      }
    }
    const history: HistoryMsg[] = msgs.map((m) => ({
      author: m.author, kind: m.kind ?? "text", text: m.body ?? m.transcript ?? null, at: m.created_at,
    }));

    // ── Reglas, info del negocio y fichas ya mostradas ──
    const [{ data: rv }, { data: bi }, { data: lastSent }, { data: lead }] = await Promise.all([
      db.from("rules_versions").select("rules").eq("published", true).order("version", { ascending: false }).limit(1).maybeSingle(),
      db.from("business_info").select("key, title, body").neq("body", "").order("sort"),
      db.from("audit_log").select("details").eq("conversation_id", conversationId).in("event", ["sent", "sent_handoff"])
        .order("created_at", { ascending: false }).limit(3),
      db.from("lead_profiles").select("name").eq("contact_id", conv.contact_id).maybeSingle(),
    ]);
    const contact = conv.contact as unknown as { name: string | null; display_name: string | null } | null;
    const clientName = clientFirstName({ name: contact?.name, profileName: (lead?.name as { value?: string } | null)?.value, displayName: contact?.display_name });
    const shownCodes = [...new Set((lastSent ?? []).flatMap((a) => ((a.details as { property_codes?: string[] } | null)?.property_codes ?? [])))].slice(0, 3);
    let recentlyShown: ReturnType<typeof toFact>[] = [];
    if (shownCodes.length) {
      const { data } = await db.from("properties_public").select(PUBLIC_COLUMNS).in("reference_code", shownCodes);
      recentlyShown = ((data ?? []) as unknown as PublicRow[]).map(toFact);
    }

    const llm = opts.llm ?? new OpenAiLlm();
    const decision = await decide(
      { history, channelOperation, rules: (rv?.rules ?? []) as Rule[], businessInfo: (bi ?? []) as BusinessInfo[], recentlyShown, clientName },
      {
        llm,
        search: async (f) => (await searchProperties(db, f)) as unknown as PublicRow[],
        byCode: async (code) => {
          const { data } = await db.from("properties_public").select(PUBLIC_COLUMNS).ilike("reference_code", code).limit(1).maybeSingle();
          return (data as unknown as PublicRow) ?? null;
        },
      },
    );
    usage = addUsage(usage, decision.usage);
    const allTrace = [...trace, ...decision.trace];

    if (decision.action === "ignore") {
      if (allTrace.length) await commit(db, conversationId, messageId, { body: null, handoff: false, reason: null, trace: allTrace });
      return "ignored";
    }
    return await commit(db, conversationId, messageId, {
      body: decision.body, handoff: decision.action === "handoff", reason: decision.action === "handoff" ? decision.reason : null,
      trace: allTrace, codes: decision.propertyCodes,
    }, silent);
  } catch (e) {
    console.error("[bot] error en el turno conv=%s: %s", conversationId, (e as Error).message);
    // Salida de emergencia: avisar al cliente y pasar el chat a una persona.
    try {
      return await commit(db, conversationId, messageId, { body: PHRASES.generic, handoff: true, reason: "Error interno del bot",
        trace: [{ event: "agent_error", summary: "Error interno del bot", details: { error: (e as Error).message.slice(0, 200) } }] }, silent);
    } catch { return "error"; }
  } finally {
    if (usage.costUsd > 0 || usage.inputTokens > 0) {
      await db.rpc("add_usage", { p_in: usage.inputTokens, p_out: usage.outputTokens, p_audio: usage.audioSeconds, p_cost: usage.costUsd });
    }
  }
}

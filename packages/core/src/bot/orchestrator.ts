// Orquestador del turno del bot: CÓDIGO. Decide el camino, busca, controla y, ante la duda, deriva.
// La IA solo interpreta (clasificador), redacta (redactor) y revisa (verificador).
import { normalize, type SearchFilters } from "../retrieval/search";
import { classifyTurn, draftReply, verifyReply, type Classification } from "./agents";
import { toFact, type PublicRow } from "./facts";
import { addUsage, emptyUsage, type Llm, type Usage } from "./llm";
import { checkNumbers } from "./numeric";
import type { Decision, HistoryMsg, PropertyFact, TraceEntry, TurnInput } from "./types";

export interface OrchestratorDeps {
  llm: Llm;
  search: (f: SearchFilters) => Promise<PublicRow[]>;
  byCode: (code: string) => Promise<PublicRow | null>;
}

// Textos fijos (no los escribe el modelo).
export const PHRASES = {
  generic: "Gracias por escribir. Le paso tu consulta a alguien del equipo, que te va a responder a la brevedad.",
  media: "¡Gracias! Le paso esto a alguien del equipo para que lo vea y te responda.",
} as const;

const MIN_CONFIDENCE = 0.5;
const MAX_RESULTS = 3;

/** Mensajes del cliente desde la última respuesta (del bot o del equipo): lo que hay que contestar. */
export function pendingTurn(history: HistoryMsg[]): HistoryMsg[] {
  let i = history.length;
  while (i > 0 && history[i - 1]!.author === "client") i--;
  return history.slice(i);
}

/** Pasos de búsqueda: exacta y, si no hay nada, cada vez más amplia. */
export function searchPlan(c: Classification, channelOp: "sale" | "rent"): { filters: SearchFilters; note: string | null }[] {
  const f = c.filters;
  const type = f.property_type ? normalize(f.property_type) : undefined;
  const base: SearchFilters = {
    operation: f.operation ?? channelOp,
    propertyType: type,
    zone: f.zone ?? undefined,
    roomsMin: f.rooms_min ?? undefined,
    bedroomsMin: f.bedrooms_min ?? undefined,
    priceMax: f.price_max ?? undefined,
    currency: f.price_max ? (f.currency ?? undefined) : undefined,
    pets: f.pets === true ? true : undefined,
    text: f.keywords ?? undefined,
    limit: MAX_RESULTS,
  };
  const steps: { filters: SearchFilters; note: string | null }[] = [{ filters: base, note: null }];
  if (base.text) steps.push({ filters: { ...base, text: undefined }, note: "Aproximada: sin las características pedidas (" + base.text + ")." });
  if (base.priceMax || base.roomsMin || base.bedroomsMin)
    steps.push({ filters: { ...base, text: undefined, priceMax: undefined, currency: undefined, roomsMin: undefined, bedroomsMin: undefined },
      note: "Aproximada: no hay con ese presupuesto/ambientes; se muestran las más cercanas en precio de la misma zona y tipo." });
  if (base.zone && base.propertyType)
    steps.push({ filters: { operation: base.operation, propertyType: base.propertyType, limit: MAX_RESULTS },
      note: `Aproximada: no hay ${base.propertyType} en ${base.zone} con eso; se muestran de otras zonas.` });
  if (base.zone) // la zona puede estar escrita distinto en la base: probar como texto libre
    steps.splice(1, 0, { filters: { ...base, zone: undefined, text: [base.zone, base.text].filter(Boolean).join(" ") }, note: null });
  return steps;
}

export async function decide(input: TurnInput, deps: OrchestratorDeps): Promise<Decision> {
  const trace: TraceEntry[] = [];
  let usage: Usage = emptyUsage();
  const handoff = (reason: string, body: string | null = PHRASES.generic, codes: string[] = []): Decision =>
    ({ action: "handoff", body, reason, propertyCodes: codes, trace, usage });

  const pending = pendingTurn(input.history);
  if (pending.length === 0) return { action: "ignore", reason: "no hay mensajes nuevos del cliente", trace, usage };

  // ── Tipos de mensaje que el bot no puede leer ──
  const readable = pending.filter((m) => m.text && m.text.trim());
  if (readable.length === 0) {
    if (pending.every((m) => m.kind === "sticker")) return { action: "ignore", reason: "solo stickers", trace, usage };
    const kinds = [...new Set(pending.map((m) => m.kind))].join(", ");
    trace.push({ event: "unreadable", summary: `El cliente mandó algo que el bot no puede leer (${kinds})`, details: { kinds } });
    return handoff(`El cliente mandó ${kinds}`, PHRASES.media);
  }
  const unreadable = pending.filter((m) => !(m.text && m.text.trim()) && m.kind !== "sticker");

  // ── Clasificador ──
  let c: Classification;
  try {
    const r = await classifyTurn(deps.llm, input.history, input.rules);
    c = r.data; usage = addUsage(usage, r.usage);
  } catch (e) {
    trace.push({ event: "agent_error", summary: "El clasificador falló", details: { error: (e as Error).message.slice(0, 200) } });
    return handoff("El bot no pudo interpretar el mensaje");
  }
  trace.push({ event: "classified", summary: `Clasificado como "${c.intent}"${c.reserved_topic ? ` (${c.reserved_topic})` : ""}`,
    details: { intent: c.intent, reserved_topic: c.reserved_topic, filters: c.filters, property_code: c.property_code,
      refers_to_shown: c.refers_to_shown, confidence: c.confidence } });

  // ── Temas reservados: frase fija de la regla y a una persona ──
  const rule = c.reserved_topic ? input.rules.find((r) => r.topic === c.reserved_topic) : undefined;
  if (c.intent === "tema_reservado" || rule) {
    return handoff(`Tema reservado: ${rule?.topic ?? c.reserved_topic ?? "sin tema"}`, rule?.handoff_phrase ?? PHRASES.generic);
  }
  if (c.confidence < MIN_CONFIDENCE) {
    return handoff(`El bot no está seguro de qué pide el cliente (confianza ${c.confidence.toFixed(2)})`);
  }
  if (unreadable.length) {
    // Texto + algo que no puede leer (ej. foto sin texto): responde el texto pero que lo vea una persona.
    trace.push({ event: "unreadable", summary: "Además mandó algo que el bot no puede leer", details: { kinds: unreadable.map((m) => m.kind) } });
  }

  // ── Datos: búsqueda por código ──
  let properties: PropertyFact[] = [];
  let searchNote: string | null = null;
  if (c.intent === "busqueda" || c.intent === "consulta_propiedad") {
    if (c.property_code) {
      const row = await deps.byCode(c.property_code.trim());
      if (row) properties = [toFact(row)];
      else searchNote = `No hay ninguna propiedad disponible con el código ${c.property_code}.`;
    }
    if (!properties.length && (c.refers_to_shown || c.intent === "consulta_propiedad") && input.recentlyShown.length) {
      properties = input.recentlyShown.slice(0, MAX_RESULTS);
      searchNote = "Son las fichas que el bot ya mostró en este chat.";
    }
    if (!properties.length && c.intent === "busqueda") {
      for (const step of searchPlan(c, input.channelOperation)) {
        const rows = await deps.search(step.filters);
        if (rows.length) { properties = rows.map(toFact); searchNote = step.note; break; }
      }
      if (!properties.length) searchNote = "No hay propiedades disponibles con esos criterios ni parecidas.";
    }
    trace.push({ event: "searched", summary: properties.length
      ? `Encontró ${properties.length} propiedad(es)${searchNote ? " (aproximado)" : ""}`
      : "No encontró propiedades", details: { codes: properties.map((p) => p.codigo), note: searchNote } });
  }

  // ── Redactor → control numérico → verificador (un reintento) ──
  const isFirstReply = !input.history.some((m) => m.author === "ai");
  const clientTexts = input.history.filter((m) => m.author === "client").map((m) => m.text ?? "");
  const priorBotTexts = input.history.filter((m) => m.author === "ai" || m.author === "human").map((m) => m.text ?? "");
  let feedback: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let d;
    try {
      const r = await draftReply(deps.llm, { history: input.history, intent: c.intent, properties, searchNote,
        businessInfo: input.businessInfo, isFirstReply, feedback });
      d = r.data; usage = addUsage(usage, r.usage);
    } catch (e) {
      trace.push({ event: "agent_error", summary: "El redactor falló", details: { error: (e as Error).message.slice(0, 200) } });
      return handoff("El bot no pudo redactar la respuesta");
    }
    const reply = d.reply.trim();
    if (!reply) return handoff("El redactor devolvió una respuesta vacía");
    trace.push({ event: "drafted", summary: `Respuesta redactada (intento ${attempt})`,
      details: { attempt, chars: reply.length, codes: d.property_codes_used, needs_human: d.needs_human } });

    const num = checkNumbers(reply, [properties, input.businessInfo, clientTexts, priorBotTexts], properties.length);
    if (!num.ok) {
      trace.push({ event: "rejected_numeric", summary: "Control numérico: la respuesta tenía números o links que no están en los datos",
        details: { attempt, numbers: num.unknownNumbers, urls: num.unknownUrls } });
      feedback = [
        ...num.unknownNumbers.map((n) => `El número ${n} no está en DATOS: sacalo o usá el valor exacto de DATOS.`),
        ...num.unknownUrls.map((u) => `El link ${u} no está en DATOS: usá solo los links de las fichas.`),
      ];
      continue;
    }

    let v;
    try {
      const r = await verifyReply(deps.llm, { history: input.history, properties, businessInfo: input.businessInfo, reply });
      v = r.data; usage = addUsage(usage, r.usage);
    } catch (e) {
      trace.push({ event: "agent_error", summary: "El verificador falló", details: { error: (e as Error).message.slice(0, 200) } });
      return handoff("El bot no pudo verificar su respuesta");
    }
    if (!v.ok) {
      trace.push({ event: "rejected_verifier", summary: "El verificador rechazó la respuesta", details: { attempt, problems: v.problems.slice(0, 5) } });
      feedback = v.problems.slice(0, 5);
      continue;
    }
    trace.push({ event: "verified", summary: "Respuesta verificada", details: { attempt } });

    const codes = d.property_codes_used.filter((code) => properties.some((p) => p.codigo === code));
    if (d.needs_human || unreadable.length) {
      return handoff(d.human_reason?.trim() || (unreadable.length ? "Mandó algo que el bot no puede leer" : "El bot necesita a una persona"), reply, codes);
    }
    return { action: "reply", body: reply, propertyCodes: codes, trace, usage };
  }
  return handoff("La respuesta del bot no pasó los controles dos veces");
}

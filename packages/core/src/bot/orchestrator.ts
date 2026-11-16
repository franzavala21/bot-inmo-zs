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
  otherOperation: {
    rent: "Los alquileres los atiende otra persona del equipo. Le paso tu consulta para que te responda a la brevedad.",
    sale: "Las ventas las atiende otra persona del equipo. Le paso tu consulta para que te responda a la brevedad.",
  },
} as const;

const MIN_CONFIDENCE = 0.5;

// Si la respuesta dice que sigue una persona o que al bot le falta un dato, el turno se deriva
// aunque el redactor no lo haya marcado: lo que se le dice al cliente tiene que pasar de verdad.
const PROMISES_HUMAN = /(persona|alguien|uno|una) del equipo|(asesor|vendedor|agente)\b.*\b(contact|llam|escrib|respond|pasa)|consult(o|amos|ar[ée]) con el equipo|te (contacta|llama|escribe) (un|una|alguien)/i;
const LACKS_DATA = /\bno (tengo|cuento con|dispongo de)\b.{0,25}\b(informaci[oó]n|dato|datos|detalle)/i;
const STREET_WORDS = /\b(calle|av|avda|avenida|ruta|esquina|pasaje|psje|bv|bulevar|boulevard|diagonal|camino|sobre|entre|al)\b|n[°º]|\bkm\b/;
export function looksLikeAddress(quote: string): boolean {
  const q = quote.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\d/.test(q) || STREET_WORDS.test(q);
}

// "No tengo casas", "solo hay terrenos": las fichas son una muestra, así que eso solo se puede decir si la búsqueda
// lo respalda (nota de búsqueda aproximada o vacía). Caso real 2026-11-13: dijo que no había casas y había una de USD 95.000.
const CLAIMS_NONE = /\b(no (tengo|hay|tenemos|contamos con|dispongo de|cuento con)|s[oó]lo (tengo|hay|tenemos|cuento con))\b[^.?!\n]{0,50}\b(casas?|terrenos?|lotes?|departamentos?|deptos?|ph|locales?|oficinas?|propiedad(es)?|opci[oó]n(es)?|nada)\b/i;
export function claimsNoneWithoutSupport(reply: string, searchNote: string | null, searched: boolean): string | null {
  // Solo la búsqueda aproximada o vacía respalda un "no hay" (la nota de tipos disponibles no).
  if (!searched || (searchNote && /^(Aproximada|No hay)/.test(searchNote))) return null;
  const m = reply.match(CLAIMS_NONE);
  return m ? m[0] : null;
}

const LEAD_WORDS = new Set(["con", "y", "e", "es", "son", "tiene", "tienen", "cuenta", "incluye", "ideal", "muy", "un", "una", "el", "la", "los", "las"]);
/**
 * El verificador a veces marca como "dato no respaldado" algo que está tal cual en la ficha ("apto crédito").
 * Se descarta la objeción si CADA parte de la cita (separada por comas o "y") aparece seguida, palabra por palabra,
 * en los valores de las fichas o de la info del negocio. Los "no hay / no tengo" los controla claimsNoneWithoutSupport.
 */
export function supportedByFacts(quote: string, factsTexts: string | string[]): boolean {
  const n = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9ñ ,]+/g, " ").replace(/\s+/g, " ").trim();
  const q = n(quote.replace(/(^|\s)\d{1,2}[).]\s/g, " ")); // sin numeradores de lista ("1) Casa…")
  if (/\b(no (tengo|hay|tenemos|cuento|dispongo)|con exactamente eso no)\b/.test(q)) return true;
  const texts = (Array.isArray(factsTexts) ? factsTexts : [factsTexts]).map((t) => ` ${n(t).replace(/,/g, " ")} `);
  const parts = q.split(/,| y /).map((p) => p.trim().split(" ").filter(Boolean)).map((w) => {
    while (w.length && LEAD_WORDS.has(w[0])) w.shift();
    return w.join(" ");
  }).filter((p) => p.length >= 3);
  if (!parts.length) return false;
  // a) Cada parte aparece tal cual en una misma ficha.
  if (texts.some((f) => parts.every((p) => f.includes(` ${p} `)))) return true;
  // b) Una ficha descripta con sus datos ("Casa 2 dormitorios, terreno 233 m², escritura inmediata, USD 59.000"):
  //    los números los controla checkNumbers; acá alcanza con que cada palabra con contenido esté en UNA misma ficha.
  //    Los números de la cita también tienen que estar en ESA ficha (si no, se mezclarían datos de dos propiedades).
  const tokens = q.split(/[ ,]+/).filter(Boolean);
  const words = [...new Set(tokens.filter((w) => w.length >= 3 && !/\d/.test(w) && !STRUCTURE_WORDS.has(w)))];
  const nums = [...new Set(tokens.filter((w) => /^\d+$/.test(w)))];
  // Singular/plural y género ("apta" en la respuesta, "apto" en la ficha).
  const forms = (w: string) => { const base = w.replace(/(es|s)$/, ""); return [w, base, `${w}s`, base.replace(/a$/, "o"), base.replace(/o$/, "a")]; };
  const has = (f: string, w: string) => forms(w).some((x) => f.includes(` ${x} `) || f.includes(` ${x}s `));
  return texts.some((f) => words.every((w) => has(f, w)) && nums.every((x) => f.includes(` ${x} `)));
}

/** Palabras de estructura al describir una ficha: no afirman nada por sí solas (los números se controlan aparte). */
const STRUCTURE_WORDS = new Set(["dormitorio", "dormitorios", "dorm", "ambiente", "ambientes", "amb", "bano", "banos", "terreno", "lote",
  "superficie", "cubierto", "cubiertos", "cubierta", "cubiertas", "total", "usd", "ars", "precio", "por", "con", "del", "las", "los",
  "una", "uno", "que", "mas", "info", "link", "aca", "ver", "tiene", "cuenta", "esta", "ubicada", "ubicado", "venta"]);

/** Texto de los VALORES de las fichas y la info del negocio (sin nombres de campos ni mascotas, que es sí/no). */
function factsValues(properties: PropertyFact[], info: { title: string; body: string }[]): string {
  const vals: string[] = [];
  for (const p of properties) for (const [k, v] of Object.entries(p)) {
    if (k === "mascotas" || v == null) continue;
    vals.push(Array.isArray(v) ? v.join(" , ") : String(v));
  }
  for (const b of info) vals.push(b.title, b.body);
  return vals.join(" , ");
}

export function impliesHandoff(reply: string): string | null {
  if (PROMISES_HUMAN.test(reply)) return "La respuesta le dice al cliente que sigue una persona del equipo";
  if (LACKS_DATA.test(reply)) return "El cliente pidió un dato que el bot no tiene";
  return null;
}
const MAX_RESULTS = 3;

/** Mensajes del cliente desde la última respuesta (del bot o del equipo): lo que hay que contestar. */
export function pendingTurn(history: HistoryMsg[]): HistoryMsg[] {
  let i = history.length;
  while (i > 0 && history[i - 1]!.author === "client") i--;
  return history.slice(i);
}

/** Pasos de búsqueda: exacta y, si no hay nada, cada vez más amplia. */
/** Elige hasta MAX_RESULTS alternando tipos (en el orden que vino) y cuenta cuántas hay de cada tipo. */
export function mixByType<T extends { property_type: string | null }>(rows: T[], max = MAX_RESULTS): { picked: T[]; counts: [string, number][] } {
  const groups = new Map<string, T[]>();
  for (const r of rows) { const k = r.property_type ?? "Otro"; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const picked: T[] = [];
  for (let i = 0; picked.length < max && i < rows.length; i++) {
    for (const g of groups.values()) { if (g[i] && picked.length < max) picked.push(g[i]); }
  }
  return { picked, counts: [...groups.entries()].map(([k, v]) => [k, v.length]) };
}

// ── Calificación del lead ──
export type Qualifier = "type" | "budget" | "credit";
export const QUESTION: Record<Qualifier, string> = {
  type: "qué tipo de propiedad busca",
  budget: "con qué presupuesto aproximado cuenta",
  credit: "si la compraría con crédito hipotecario (así le muestra las que son aptas crédito) o de contado",
};
const ASKED_LABEL: Record<Qualifier, string> = { type: "el tipo", budget: "el presupuesto", credit: "si va con crédito" };
/** Viviendas: las que pueden ser aptas crédito hipotecario. */
const CREDIT_TYPES = /^(casa|departamento|ph|duplex|chalet|cabana)/;

/** Qué falta saber antes de mostrar propiedades. Nunca vuelve a pedir algo que ya se preguntó (si no contestó, se sigue igual). */
export function qualifyGaps(f: Classification["filters"], type: string | null, asked: Set<string>): Qualifier[] {
  const gaps: Qualifier[] = [];
  if (!f.price_max && !f.price_min && !asked.has("budget")) gaps.push("budget");
  if (type && CREDIT_TYPES.test(type) && (f.credit ?? "no_dijo") === "no_dijo" && !asked.has("credit")) gaps.push("credit");
  return gaps;
}

// ── Preguntas de seguimiento (decisión de los dueños): una por mensaje, solo después de mostrar propiedades ──
export type FollowUp = "credit" | "sell" | "purpose" | "bedrooms" | "name" | "alerts";
const FOLLOW_UPS: FollowUp[] = ["credit", "sell", "purpose", "bedrooms", "name", "alerts"];
export const FOLLOW_UP_QUESTION: Record<FollowUp, string> = {
  credit: "si la compraría con crédito hipotecario o de contado",
  sell: "si tiene que vender alguna propiedad para poder comprar",
  purpose: "si la busca para vivir, para fines de semana o como inversión",
  bedrooms: "cuántos dormitorios necesita",
  name: "cómo se llama",
  // Permiso para avisos con plantilla (Meta exige que el cliente acepte recibirlos).
  alerts: "si quiere que le avisemos por este WhatsApp cuando entre una propiedad parecida",
};
/** La próxima pregunta que falta: saltea lo que ya se sabe y lo que ya se preguntó en este chat. */
export function nextFollowUp(k: { financing?: string | null; purpose?: string | null; bedrooms?: boolean; hasName: boolean; housing: boolean; credit?: string; alerts?: boolean | null }, asked: Set<string>): FollowUp | null {
  const known: Record<FollowUp, boolean> = {
    // Crédito: solo viviendas (si pregunta por un aviso puntual no pasó por la calificación previa).
    credit: !k.housing || k.credit === "credito" || k.credit === "contado" || !!k.financing,
    sell: k.financing === "cash" || k.financing === "needs_to_sell", // con crédito igual puede necesitar vender
    purpose: !!k.purpose,
    bedrooms: !k.housing || !!k.bedrooms, // para terrenos no se pregunta
    name: k.hasName,
    alerts: k.alerts != null,
  };
  return FOLLOW_UPS.find((q) => !known[q] && !asked.has(q)) ?? null;
}

export function searchPlan(c: Classification, channelOp: "sale" | "rent"): { filters: SearchFilters; note: string | null }[] {
  const f = c.filters;
  const type = f.property_type ? normalize(f.property_type) : undefined;
  const base: SearchFilters = {
    operation: channelOp, // el canal manda: la otra operación se deriva antes de buscar
    propertyType: type,
    zone: f.zone ?? undefined,
    roomsMin: f.rooms_min ?? undefined,
    bedroomsMin: f.bedrooms_min ?? undefined,
    // Un solo número ("60000 dólares") es el tope, no un precio exacto: el modelo a veces lo pone de mínimo y de máximo.
    priceMin: f.price_min && f.price_min !== f.price_max ? f.price_min : undefined,
    priceMax: f.price_max ?? undefined,
    currency: f.price_max || f.price_min ? (f.currency ?? undefined) : undefined,
    pets: f.pets === true ? true : undefined,
    text: f.keywords ?? undefined,
    limit: MAX_RESULTS,
  };
  const steps: { filters: SearchFilters; note: string | null }[] = [{ filters: base, note: null }];
  if (base.text) steps.push({ filters: { ...base, text: undefined }, note: "Aproximada: no hay con todas las características pedidas (" + base.text + "); se muestran sin esa condición." });
  if (base.priceMax)
    steps.push({ filters: { ...base, text: undefined, priceMin: undefined, priceMax: Math.round(base.priceMax * 1.25) },
      note: "Aproximada: no hay hasta ese presupuesto; se muestran hasta un 25 % por encima (decíselo)." });
  if (base.priceMax || base.priceMin || base.roomsMin || base.bedroomsMin)
    steps.push({ filters: { ...base, text: undefined, priceMin: undefined, priceMax: undefined, currency: undefined, roomsMin: undefined, bedroomsMin: undefined },
      note: "Aproximada: no hay con ese presupuesto/ambientes; se muestran las más cercanas en precio de la misma zona y tipo." });
  if (base.zone && base.propertyType)
    steps.push({ filters: { operation: base.operation, propertyType: base.propertyType, limit: MAX_RESULTS },
      note: `Aproximada: no hay ${base.propertyType} en ${base.zone} con eso; se muestran de otras zonas.` });
  if (base.zone) // la zona puede estar escrita distinto en la base: probar como texto libre
    steps.splice(1, 0, { filters: { ...base, zone: undefined, text: [base.zone, base.text].filter(Boolean).join(" ") }, note: null });
  if (f.credit === "credito") {
    // Va con crédito: primero las que dicen "apto crédito"; si no hay, las demás sin afirmar que lo son.
    const warn = "Ninguna de estas figura como apta crédito en la ficha: no digas que lo son (si pregunta, eso hay que confirmarlo).";
    const plain = steps.splice(0);
    steps.push({ filters: { ...base, text: [base.text, "apto credito"].filter(Boolean).join(" ") }, note: null });
    steps.push(...plain.map((st) => ({ ...st, note: [st.note, warn].filter(Boolean).join(" ") })));
  }
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

  // ── Otra operación (ej. alquiler en el canal de ventas): la atiende otra persona ──
  const otherOp = (op: "sale" | "rent" | null | undefined) => !!op && op !== input.channelOperation;
  if ((c.intent === "busqueda" || c.intent === "consulta_propiedad") && otherOp(c.filters.operation)) {
    return handoff(`Pide ${c.filters.operation === "rent" ? "alquiler" : "venta"}: lo atiende otra persona`, PHRASES.otherOperation[c.filters.operation!]);
  }

  // ── Datos: búsqueda por código ──
  const type = c.filters.property_type ? normalize(c.filters.property_type) : null;
  let properties: PropertyFact[] = [];
  let searchNote: string | null = null;
  let didSearch = false;
  const asked = new Set(input.asked ?? []);
  const askedNow: Qualifier[] = [];
  if (c.intent === "busqueda" || c.intent === "consulta_propiedad") {
    if (c.property_code) {
      const row = await deps.byCode(c.property_code.trim());
      if (row && otherOp(row.operation)) {
        return handoff(`Consulta por una propiedad en ${row.operation === "rent" ? "alquiler" : "venta"}: lo atiende otra persona`, PHRASES.otherOperation[row.operation!]);
      }
      if (row) properties = [toFact(row)];
      else searchNote = `No hay ninguna propiedad disponible con el código ${c.property_code}.`;
    }
    if (!properties.length && (c.refers_to_shown || c.intent === "consulta_propiedad") && input.recentlyShown.length) {
      properties = input.recentlyShown.slice(0, MAX_RESULTS);
      searchNote = "Son las fichas que el bot ya mostró en este chat.";
    }
    const f = c.filters;
    const hasCriteria = !!(f.property_type || f.zone || f.rooms_min || f.bedrooms_min || f.price_max || f.price_min || f.keywords || f.pets || f.credit === "credito" || f.credit === "contado");
    if (!properties.length && c.intent === "busqueda" && !hasCriteria) {
      searchNote = "El cliente todavía no dio ningún criterio: no se buscó. Preguntale qué tipo de propiedad y en qué zona.";
    } else if (!properties.length && c.intent === "busqueda") {
      // ── Calificación (decisión de los dueños): antes de mostrar, saber presupuesto y, si es vivienda, si va con crédito ──
      const gaps = type ? qualifyGaps(f, type, asked) : [];
      if (gaps.length) {
        askedNow.push(...gaps);
        searchNote = `Antes de mostrar propiedades hay que conocer mejor al cliente. No muestres fichas ni digas que hay o que no hay: en un solo mensaje corto y natural, preguntale ${gaps.map((g) => QUESTION[g]).join(" y ")}.`;
      } else {
        didSearch = true;
        // Lo que ya se le mostró no se repite ("¿tenés otras opciones?").
        const exclude = [...new Set([...(input.shownCodes ?? []), ...input.recentlyShown.map((p) => p.codigo)])];
        for (const step0 of searchPlan(c, input.channelOperation)) {
          const step = exclude.length ? { ...step0, filters: { ...step0.filters, excludeCodes: exclude } } : step0;
          // Sin tipo de propiedad: se trae una muestra amplia para saber qué tipos hay.
          const rows = await deps.search(step.filters.propertyType ? step.filters : { ...step.filters, limit: 30 });
          if (!rows.length) continue;
          if (step.filters.propertyType) { properties = rows.map(toFact); searchNote = step.note; break; }
          const mix = mixByType(rows);
          const types = mix.counts.map(([t, n]) => `${t} (${n}${n >= 30 ? " o más" : ""})`).join(", ");
          if (mix.counts.length > 1 && !asked.has("type")) {
            // Si hay más de un tipo, primero se pregunta cuál busca (y el presupuesto, si falta) y después se muestran fichas.
            askedNow.push("type");
            const alsoBudget = !f.price_max && !f.price_min && !asked.has("budget");
            if (alsoBudget) askedNow.push("budget");
            searchNote = `El cliente no dijo qué tipo de propiedad busca. Con esos criterios hay: ${types}. No muestres fichas todavía: preguntale qué tipo busca, nombrando esos tipos${alsoBudget ? `, y ${QUESTION.budget}, en el mismo mensaje` : ""}.`;
            break;
          }
          properties = mix.picked.map(toFact);
          searchNote = [step.note, mix.counts.length > 1
            ? `Ya se le preguntó el tipo y no lo eligió. Con esos criterios hay: ${types}. Mostrá estas de muestra.`
            : null].filter(Boolean).join(" ") || null;
          break;
        }
        if (!properties.length && !askedNow.length) searchNote = exclude.length
          ? "No hay más propiedades distintas de las que ya se le mostraron con esos criterios ni parecidas. Decíselo y preguntale si puede ampliar zona, presupuesto o tipo."
          : "No hay propiedades disponibles con esos criterios ni parecidas.";
      }
    }
    trace.push({ event: "searched", summary: properties.length
      ? `Encontró ${properties.length} propiedad(es)${searchNote ? " (aproximado)" : ""}`
      : askedNow.length ? `Calificación: preguntó ${askedNow.map((a) => ASKED_LABEL[a]).join(" y ")}` : "No encontró propiedades",
      details: { codes: properties.map((p) => p.codigo), note: searchNote, ...(askedNow.length ? { asked: askedNow } : {}) } });
  }

  // ── Redactor → control numérico → verificador (un reintento) ──
  const isFirstReply = !input.history.some((m) => m.author === "ai");
  // Pregunta de seguimiento: si esta respuesta muestra propiedades, o si es charla después de haberlas mostrado.
  const showing = properties.length > 0 || (c.intent === "charla" && input.recentlyShown.length > 0);
  const shownTypes = (properties.length ? properties : input.recentlyShown).map((p) => normalize(p.tipo ?? ""));
  const followUp = showing ? nextFollowUp({
    financing: input.lead?.financing, purpose: input.lead?.purpose,
    bedrooms: !!(c.filters.bedrooms_min || c.filters.rooms_min || input.lead?.rooms_min),
    hasName: !!input.clientName,
    credit: c.filters.credit,
    alerts: input.lead?.wants_alerts ?? null,
    housing: (type ? [type] : shownTypes).some((t) => CREDIT_TYPES.test(t)),
  }, asked) : null;
  const clientTexts = input.history.filter((m) => m.author === "client").map((m) => m.text ?? "");
  const priorBotTexts = input.history.filter((m) => m.author === "ai" || m.author === "human").map((m) => m.text ?? "");
  let feedback: string[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let d;
    try {
      const r = await draftReply(deps.llm, { history: input.history, intent: c.intent, properties, searchNote,
        businessInfo: input.businessInfo, isFirstReply, clientName: input.clientName ?? null,
        closingQuestion: followUp ? FOLLOW_UP_QUESTION[followUp] : null, feedback });
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

    const none = claimsNoneWithoutSupport(reply, searchNote, didSearch);
    if (none) {
      trace.push({ event: "rejected_claim", summary: "Control de código: dijo que no hay algo que la búsqueda no descartó", details: { attempt, quote: none } });
      feedback = [`Dijiste «${none}», pero las fichas son solo una muestra: no digas que no hay o que solo hay algo. Mostrá las fichas y, si falta saber el tipo, preguntalo.`];
      continue;
    }

    let v;
    try {
      const r = await verifyReply(deps.llm, { history: input.history, properties, searchNote, businessInfo: input.businessInfo, reply });
      v = r.data; usage = addUsage(usage, r.usage);
    } catch (e) {
      trace.push({ event: "agent_error", summary: "El verificador falló", details: { error: (e as Error).message.slice(0, 200) } });
      return handoff("El bot no pudo verificar su respuesta");
    }
    // Solo cuentan las citas que de verdad están en la respuesta (el verificador a veces cita al cliente).
    const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/["«»“”]/g, "").replace(/\s+/g, " ").trim();
    const replyNorm = norm(reply);
    const violations = v.violations
      .filter((x) => { const q = norm(x.quote); return q.length >= 3 && replyNorm.includes(q); })
      // Una "dirección" sin número ni palabra de calle es una zona o un barrio: eso se puede decir.
      .filter((x) => x.rule !== "direccion_exacta" || looksLikeAddress(x.quote))
      // "Dato no respaldado" que está tal cual en la ficha: el verificador se equivocó.
      .filter((x) => x.rule !== "dato_no_respaldado" || !supportedByFacts(x.quote, [...properties.map((p) => factsValues([p], [])), factsValues([], input.businessInfo)]))
      // La pregunta de permiso para avisos la eligió el código: preguntar no es prometer.
      .filter((x) => !(followUp === "alerts" && x.rule === "promesa_de_escribir_despues" && /\?\s*$/.test(x.quote)))
      // Una pregunta al cliente no afirma ningún dato.
      .filter((x) => x.rule !== "dato_no_respaldado" || !/^\s*¿|\?\s*$/.test(x.quote))
      .map((x) => `${x.rule}: «${x.quote.trim()}»`);
    const ignored = v.violations.length - violations.length;
    if (ignored) trace.push({ event: "verifier_ignored", summary: `Se ignoran ${ignored} objeción(es) del verificador: la cita no está en la respuesta o el dato está en la ficha`, details: { attempt, ignored: v.violations.slice(0, 5) } });
    if (violations.length) {
      trace.push({ event: "rejected_verifier", summary: "El verificador rechazó la respuesta", details: { attempt, problems: violations.slice(0, 5) } });
      feedback = violations.slice(0, 5);
      continue;
    }
    trace.push({ event: "verified", summary: "Respuesta verificada", details: { attempt } });

    const codes = d.property_codes_used.filter((code) => properties.some((p) => p.codigo === code));
    const implied = impliesHandoff(reply);
    if (d.needs_human || unreadable.length || implied) {
      if (implied && !d.needs_human) trace.push({ event: "handoff_forced", summary: `Se deriva por control de código: ${implied}` });
      return handoff(d.human_reason?.trim() || implied || (unreadable.length ? "Mandó algo que el bot no puede leer" : "El bot necesita a una persona"), reply, codes);
    }
    if (followUp) trace.push({ event: "follow_up", summary: `Pregunta de seguimiento: ${FOLLOW_UP_QUESTION[followUp]}`, details: { asked: [followUp] } });
    return { action: "reply", body: reply, propertyCodes: codes, trace, usage };
  }
  return handoff("La respuesta del bot no pasó los controles dos veces");
}

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { checkNumbers, extractNumbers } from "../bot/numeric";
import { decide, impliesHandoff, looksLikeAddress, PHRASES, pendingTurn, searchPlan, type OrchestratorDeps } from "../bot/orchestrator";
import { toFact, type PublicRow } from "../bot/facts";
import type { Llm } from "../bot/llm";
import type { Classification } from "../bot/agents";
import type { HistoryMsg, TurnInput } from "../bot/types";

// ───────── Control numérico ─────────
describe("control numérico", () => {
  it("lee números en formato argentino, con 'mil' y sin contar la unidad m2", () => {
    expect(extractNumbers("USD 59.000 y 1.500.000,50")).toEqual(expect.arrayContaining([59000, 1500000.5]));
    expect(extractNumbers("hasta 100 mil dólares")).toContain(100000);
    expect(extractNumbers("lote de 700 m2 y 233m²")).toEqual([700, 233]);
    expect(extractNumbers("tiene tres dormitorios")).toContain(3);
    expect(extractNumbers("Mirá: https://ficha.info/p/abc123")).toEqual([]);
    expect(extractNumbers("1. Casa\n2. Terreno")).toEqual([]);
  });
  it("aprueba solo números que están en los datos o los dijo el cliente", () => {
    const facts = [{ precio: "USD 59.000", dormitorios: 2, link: "https://ficha.info/p/x1" }];
    expect(checkNumbers("Tengo una casa a USD 59.000 con 2 dormitorios: https://ficha.info/p/x1", [facts]).ok).toBe(true);
    expect(checkNumbers("La casa sale 59 mil", [facts]).ok).toBe(true);
    const bad = checkNumbers("Sale USD 55.000 y tiene 3 dormitorios", [facts]);
    expect(bad.ok).toBe(false);
    expect(bad.unknownNumbers).toEqual(expect.arrayContaining([55000, 3]));
    expect(checkNumbers("Hasta 80 mil tengo esta", [facts, ["busco hasta 80 mil"]]).ok).toBe(true);
  });
  it("rechaza links que no son de las fichas", () => {
    const r = checkNumbers("Mirá https://otra.com/casa", [[{ link: "https://ficha.info/p/x1" }]]);
    expect(r.ok).toBe(false);
    expect(r.unknownUrls).toEqual(["https://otra.com/casa"]);
  });
  it("la cantidad de opciones mostradas es un número válido", () => {
    expect(checkNumbers("Te paso 3 opciones", [[]], 3).ok).toBe(true);
    expect(checkNumbers("Te paso 3 opciones", [[]], 2).ok).toBe(false);
  });
});

// ───────── Orquestador con un modelo falso ─────────
const ROW: PublicRow = {
  id: "p1", reference_code: "ZHO1", tokko_id: 1, operation: "sale", property_type: "Casa", title: "Casa en Salsipuedes",
  description: "Linda casa", price: 59000, currency: "USD", expenses: null, zone: "Salsipuedes", rooms: 4, bedrooms: 2,
  bathrooms: 1, surface_total: 233, surface_covered: 90, pets_allowed: null, amenities: ["Patio"], public_url: "https://ficha.info/p/x1",
};

const cls = (over: Partial<Classification> = {}): Classification => ({
  intent: "busqueda", reserved_topic: null,
  filters: { operation: null, property_type: "casa", zone: "Salsipuedes", rooms_min: null, bedrooms_min: null, price_max: null, currency: null, pets: null, keywords: null },
  property_code: null, refers_to_shown: false, confidence: 0.9, ...over,
});

/** Modelo falso: devuelve, por agente, las respuestas en orden. */
function fakeLlm(script: Record<string, unknown[]>): Llm & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async structured<T extends z.ZodTypeAny>({ name, schema }: { name: string; schema: T }) {
      calls.push(name);
      const next = script[name]?.shift();
      if (next === undefined) throw new Error(`sin respuesta guionada para ${name}`);
      if (next instanceof Error) throw next;
      return { data: schema.parse(next), usage: { inputTokens: 10, outputTokens: 5, audioSeconds: 0, costUsd: 0.001 } };
    },
  };
}

const deps = (llm: Llm, rows: PublicRow[] = [ROW]): OrchestratorDeps => ({
  llm, search: async () => rows, byCode: async (c) => (c === "ZHO1" ? ROW : null),
});
const msg = (text: string | null, author: HistoryMsg["author"] = "client", kind = "text"): HistoryMsg => ({ author, kind, text, at: "2026-11-05T10:00:00Z" });
const input = (history: HistoryMsg[]): TurnInput => ({
  history, channelOperation: "sale", businessInfo: [], recentlyShown: [],
  rules: [{ topic: "visita", description: "Quiere visitar", handoff_phrase: "Te contacta uno de nosotros para coordinar." }],
});
const goodReply = { reply: "¡Hola! Tengo una casa en Salsipuedes a USD 59.000: https://ficha.info/p/x1", property_codes_used: ["ZHO1"], needs_human: false, human_reason: null };

describe("orquestador", () => {
  it("toma como turno solo lo que el cliente escribió después de la última respuesta", () => {
    expect(pendingTurn([msg("a"), msg("b", "ai"), msg("c"), msg("d")]).map((m) => m.text)).toEqual(["c", "d"]);
    expect(pendingTurn([msg("a"), msg("b", "human")])).toEqual([]);
  });

  it("camino feliz: clasifica, busca, redacta, controla y verifica", async () => {
    const llm = fakeLlm({ clasificacion: [cls()], respuesta: [goodReply], verificacion: [{ violations: [] }] });
    const d = await decide(input([msg("Hola, busco casa en Salsipuedes")]), deps(llm));
    expect(d.action).toBe("reply");
    if (d.action === "reply") { expect(d.body).toContain("59.000"); expect(d.propertyCodes).toEqual(["ZHO1"]); }
    expect(llm.calls).toEqual(["clasificacion", "respuesta", "verificacion"]);
    expect(d.trace.map((t) => t.event)).toEqual(["classified", "searched", "drafted", "verified"]);
  });

  it("tema reservado: frase fija de la regla, sin redactor, y a una persona", async () => {
    const llm = fakeLlm({ clasificacion: [cls({ intent: "tema_reservado", reserved_topic: "visita" })] });
    const d = await decide(input([msg("¿La puedo ir a ver mañana a las 10?")]), deps(llm));
    expect(d.action).toBe("handoff");
    if (d.action === "handoff") expect(d.body).toBe("Te contacta uno de nosotros para coordinar.");
    expect(llm.calls).toEqual(["clasificacion"]);
  });

  it("si el clasificador falla, deriva con la frase genérica", async () => {
    const d = await decide(input([msg("hola")]), deps(fakeLlm({ clasificacion: [new Error("timeout")] })));
    expect(d.action).toBe("handoff");
    if (d.action === "handoff") expect(d.body).toBe(PHRASES.generic);
  });

  it("baja confianza → deriva", async () => {
    const d = await decide(input([msg("eh?")]), deps(fakeLlm({ clasificacion: [cls({ confidence: 0.2 })] })));
    expect(d.action).toBe("handoff");
  });

  it("un precio inventado no sale: reintenta con la corrección y, si se corrige, responde", async () => {
    const llm = fakeLlm({
      clasificacion: [cls()],
      respuesta: [{ ...goodReply, reply: "Tengo una casa a USD 55.000" }, goodReply],
      verificacion: [{ violations: [] }],
    });
    const d = await decide(input([msg("busco casa en Salsipuedes")]), deps(llm));
    expect(d.action).toBe("reply");
    expect(d.trace.some((t) => t.event === "rejected_numeric")).toBe(true);
    expect(llm.calls).toEqual(["clasificacion", "respuesta", "respuesta", "verificacion"]);
  });

  it("si falla los controles dos veces, deriva y no manda nada inventado", async () => {
    const llm = fakeLlm({
      clasificacion: [cls()],
      respuesta: [goodReply, goodReply],
      verificacion: [{ violations: [{ rule: "compromiso", quote: "Tengo una casa en Salsipuedes" }] }, { violations: [{ rule: "compromiso", quote: "Tengo una casa en Salsipuedes" }] }],
    });
    const d = await decide(input([msg("busco casa")]), deps(llm));
    expect(d.action).toBe("handoff");
    if (d.action === "handoff") expect(d.body).toBe(PHRASES.generic);
  });

  it("ignora violaciones que citan algo que no está en la respuesta (ej. al cliente)", async () => {
    const llm = fakeLlm({
      clasificacion: [cls()],
      respuesta: [goodReply],
      verificacion: [{ violations: [{ rule: "direccion_exacta", quote: "cuál es la dirección exacta" }] }],
    });
    const d = await decide(input([msg("busco casa, cuál es la dirección exacta")]), deps(llm));
    expect(d.action).toBe("reply");
    expect(d.trace.some((t) => t.event === "verifier_ignored")).toBe(true);
  });

  it("si la respuesta promete una persona o admite que falta un dato, deriva aunque el redactor no lo marque", async () => {
    expect(impliesHandoff("La ubicación precisa te la pasa una persona del equipo.")).not.toBeNull();
    expect(impliesHandoff("No tengo información sobre expensas.")).not.toBeNull();
    expect(impliesHandoff("Lo consulto con el equipo y te responden.")).not.toBeNull();
    expect(impliesHandoff("Tengo dos casas en Salsipuedes. ¿Te interesa alguna?")).toBeNull();
    const llm = fakeLlm({
      clasificacion: [cls({ intent: "consulta_propiedad", property_code: "ZHO1" })],
      respuesta: [{ reply: "No tengo información sobre expensas. ¿Querés ver otras?", property_codes_used: [], needs_human: false, human_reason: null }],
      verificacion: [{ violations: [] }],
    });
    const d = await decide(input([msg("¿expensas de la ZHO1?")]), deps(llm));
    expect(d.action).toBe("handoff");
    expect(d.trace.some((t) => t.event === "handoff_forced")).toBe(true);
  });

  it("si el redactor pide una persona, se manda su respuesta verificada y se deriva", async () => {
    const llm = fakeLlm({
      clasificacion: [cls({ intent: "consulta_propiedad", property_code: "ZHO1" })],
      respuesta: [{ reply: "Eso lo consulto con el equipo y te escriben.", property_codes_used: [], needs_human: true, human_reason: "Pregunta por expensas" }],
      verificacion: [{ violations: [] }],
    });
    const d = await decide(input([msg("¿cuánto paga de expensas la ZHO1?")]), deps(llm));
    expect(d.action).toBe("handoff");
    if (d.action === "handoff") { expect(d.body).toContain("consulto"); expect(d.reason).toBe("Pregunta por expensas"); }
  });

  it("solo un sticker: no responde; una foto sin texto: deriva sin llamar al modelo", async () => {
    const llm = fakeLlm({});
    expect((await decide(input([msg(null, "client", "sticker")]), deps(llm))).action).toBe("ignore");
    const d = await decide(input([msg(null, "client", "image")]), deps(llm));
    expect(d.action).toBe("handoff");
    if (d.action === "handoff") expect(d.body).toBe(PHRASES.media);
    expect(llm.calls).toEqual([]);
  });

  it("sin ningún criterio no busca: pregunta", async () => {
    let searched = false;
    const llm = fakeLlm({
      clasificacion: [cls({ filters: { ...cls().filters, property_type: null, zone: null } })],
      respuesta: [{ reply: "¿Qué tipo de propiedad buscás y en qué zona?", property_codes_used: [], needs_human: false, human_reason: null }],
      verificacion: [{ violations: [] }],
    });
    const d = await decide(input([msg("quiero comprar algo")]), { ...deps(llm), search: async () => { searched = true; return [ROW]; } });
    expect(d.action).toBe("reply");
    expect(searched).toBe(false);
  });

  it("sin resultados exactos amplía la búsqueda paso a paso", async () => {
    const plan = searchPlan(cls({ filters: { ...cls().filters, price_max: 30000, currency: "USD", keywords: "pileta" } }), "sale");
    expect(plan[0]!.filters).toMatchObject({ operation: "sale", propertyType: "casa", zone: "Salsipuedes", priceMax: 30000, text: "pileta" });
    expect(plan.at(-1)!.filters).toEqual({ operation: "sale", propertyType: "casa", limit: 3 });
    expect(plan.length).toBeGreaterThan(2);
  });

  it("la ficha nunca lleva dirección", () => {
    expect(Object.keys(toFact(ROW))).not.toContain("address");
    expect(JSON.stringify(toFact({ ...ROW, ...{ address: "Santa Rosa 123" } } as PublicRow))).not.toContain("Santa Rosa 123");
  });
});

describe("looksLikeAddress", () => {
  it("un barrio no es una dirección; una calle o un número sí", () => {
    expect(looksLikeAddress("Está en el barrio Villa Sol")).toBe(false);
    expect(looksLikeAddress("en Salsipuedes")).toBe(false);
    expect(looksLikeAddress("Belgrano 450")).toBe(true);
    expect(looksLikeAddress("sobre la calle Los Álamos")).toBe(true);
    expect(looksLikeAddress("Av. San Martín")).toBe(true);
  });
});

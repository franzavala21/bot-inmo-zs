import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Llm } from "../bot/llm";
import type { HistoryMsg } from "../bot/types";
import { buildExtractorPrompt, extractLead, keepQuoted, type ExtractedLead } from "../leads/extract";
import { mergeProfile, resolveConflict, type Profile } from "../leads/profile";
import { computeSignals, scoreLead, type ScoringRule } from "../leads/score";

const empty: ExtractedLead = { operation: null, zones: null, property_type: null, budget_max: null, budget_currency: null,
  rooms_min: null, pets: null, timeframe: null, financing: null, name: null, wants_visit: null, purpose: null, wants_alerts: null };
const h = (author: HistoryMsg["author"], text: string): HistoryMsg => ({ author, kind: "text", text, at: "2026-11-12T10:00:00Z" });
const chat = [h("client", "Hola, soy Juan. Busco una casa en Unquillo"), h("ai", "¿Qué presupuesto tenés?"), h("client", "Hasta 100 mil dólares, lo antes posible")];

// Reglas tal cual están en la migración 0001 (versión 1).
const RULES: ScoringRule[] = [
  { id: "has_budget", label: "Dijo presupuesto", when: { field: "budget_max", op: "present" }, points: 20 },
  { id: "has_zone", label: "Dijo zona", when: { field: "zones", op: "present" }, points: 10 },
  { id: "has_type", label: "Dijo tipo de propiedad", when: { field: "property_type", op: "present" }, points: 10 },
  { id: "has_name", label: "Dejó su nombre", when: { field: "name", op: "present" }, points: 10 },
  { id: "timeframe_soon", label: "Menos de 3 meses", when: { field: "timeframe", op: "lte_months", value: 3 }, points: 25 },
  { id: "wants_visit", label: "Pidió visitar", when: { signal: "wants_visit" }, points: 30 },
  { id: "recent", label: "Últimas 48 h", when: { signal: "active_48h" }, points: 10 },
  { id: "needs_to_sell", label: "Necesita vender", when: { field: "financing", op: "equals", value: "needs_to_sell" }, points: -10 },
];

describe("frases del cliente", () => {
  it("guarda el dato si la frase está (sin importar acentos ni mayúsculas)", () => {
    const r = keepQuoted({ ...empty, zones: { value: ["Unquillo"], quote: "casa en unquillo" }, name: { value: "Juan", quote: "SOY JUAN" } }, chat);
    expect(r.data.zones?.value).toEqual(["Unquillo"]);
    expect(r.data.name?.value).toBe("Juan");
    expect(r.dropped).toEqual([]);
  });
  it("descarta lo que no dijo el cliente, aunque lo haya dicho el bot", () => {
    const r = keepQuoted({ ...empty, budget_max: { value: 200000, quote: "200 mil" }, operation: { value: "sale", quote: "qué presupuesto tenés" } }, chat);
    expect(r.data.budget_max).toBeNull();
    expect(r.data.operation).toBeNull();
    expect(r.dropped).toEqual(["operation", "budget_max"]);
  });
  it("descarta frases vacías y listas vacías", () => {
    const r = keepQuoted({ ...empty, zones: { value: [], quote: "unquillo" }, name: { value: "Juan", quote: " " } }, chat);
    expect(r.dropped).toEqual(["zones", "name"]);
  });
  it("el extractor usa el modelo y después filtra", async () => {
    const llm: Llm = { structured: async <T extends z.ZodTypeAny>() => ({ data: { ...empty, property_type: { value: "casa", quote: "una casa" }, pets: { value: true, quote: "tengo perro" } } as z.infer<T>, usage: { inputTokens: 1, outputTokens: 1, audioSeconds: 0, costUsd: 0 } }) };
    const r = await extractLead(llm, chat);
    expect(r.data.property_type?.value).toBe("casa");
    expect(r.data.pets).toBeNull();
  });
  it("el prompt lleva la guardia y la fecha", () => {
    const p = buildExtractorPrompt(new Date("2026-11-12T15:00:00Z"));
    expect(p).toContain("12 de noviembre de 2026");
    expect(p).not.toContain("{{");
    expect(() => buildExtractorPrompt(new Date(), "sin nada")).toThrow(/GUARDIA/);
  });
});

describe("ficha: lo nuevo no pisa lo viejo", () => {
  const old: Profile = { budget_max: { value: 100000, quote: "hasta 100 mil" }, zones: { value: ["Unquillo"], quote: "en Unquillo" } };
  it("agrega lo que faltaba y suma zonas", () => {
    const r = mergeProfile(old, [], { ...empty, name: { value: "Juan", quote: "soy Juan" }, zones: { value: ["unquillo", "Mendiolaza"], quote: "o Mendiolaza" } }, "T");
    expect(r.profile.name?.value).toBe("Juan");
    expect(r.profile.zones?.value).toEqual(["Unquillo", "Mendiolaza"]);
    expect(r.changed).toEqual(["zones", "name"]);
    expect(r.conflicts).toEqual([]);
  });
  it("un valor distinto queda como contradicción, una sola vez", () => {
    const x = { ...empty, budget_max: { value: 80000, quote: "mejor 80 mil" } };
    const r1 = mergeProfile(old, [], x, "T");
    expect(r1.profile.budget_max?.value).toBe(100000);
    expect(r1.conflicts).toHaveLength(1);
    expect(mergeProfile(old, r1.conflicts, x, "T2").conflicts).toHaveLength(1);
  });
  it("el mismo valor no es contradicción", () => {
    expect(mergeProfile(old, [], { ...empty, budget_max: { value: 100000, quote: "100 lucas" } }, "T").conflicts).toEqual([]);
  });
  it("una persona acepta o descarta", () => {
    const r1 = mergeProfile(old, [], { ...empty, budget_max: { value: 80000, quote: "mejor 80 mil" } }, "T");
    expect(resolveConflict(r1.profile, r1.conflicts, 0, true, "T3").profile.budget_max?.value).toBe(80000);
    const kept = resolveConflict(r1.profile, r1.conflicts, 0, false, "T3");
    expect(kept.profile.budget_max?.value).toBe(100000);
    expect(kept.conflicts).toEqual([]);
  });
});

describe("puntaje (código, sin modelo)", () => {
  const NOW = Date.parse("2026-11-12T12:00:00Z");
  const p: Profile = {
    budget_max: { value: 100000, quote: "q" }, zones: { value: ["Unquillo"], quote: "q" }, property_type: { value: "casa", quote: "q" },
    timeframe: { value: 0, quote: "q" }, financing: { value: "needs_to_sell", quote: "q" }, zones_extra: undefined,
  } as Profile;
  it("suma regla por regla y se explica", () => {
    const s = computeSignals(["wants_visit"], new Date("2026-11-11T12:00:00Z"), NOW);
    const r = scoreLead(p, s, RULES);
    expect(r.breakdown.map((b) => b.rule_id)).toEqual(["has_budget", "has_zone", "has_type", "timeframe_soon", "wants_visit", "recent", "needs_to_sell"]);
    expect(r.score).toBe(20 + 10 + 10 + 25 + 30 + 10 - 10);
  });
  it("mismos datos, mismo resultado", () => {
    const s = computeSignals([], null, NOW);
    expect(scoreLead(p, s, RULES)).toEqual(scoreLead(p, s, RULES));
  });
  it("pasadas 48 h deja de sumar 'reciente'; plazo largo no suma", () => {
    const s = computeSignals([], new Date("2026-11-09T12:00:00Z"), NOW);
    expect(s.has("active_48h")).toBe(false);
    expect(scoreLead({ timeframe: { value: 6, quote: "q" } }, s, RULES).score).toBe(0);
  });
  it("una regla con operación desconocida no suma", () => {
    expect(scoreLead(p, new Set(), [{ id: "x", label: "x", when: { field: "zones", op: "raro" } as never, points: 99 }]).score).toBe(0);
  });
});

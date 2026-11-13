import { describe, expect, it } from "vitest";
import type { PublicRow } from "../bot/facts";
import { matchReasons, proactiveText, PROPERTY_TEMPLATE, renderTemplate, templateParams } from "../leads/matcher";
import type { Profile } from "../leads/profile";
import { nextFollowUp } from "../bot/orchestrator";
import { MetaClient, parseMetaWebhook } from "../transport/meta";
import { drainMetaOutbound } from "../transport/meta-dispatch";

const P = { id: "p1", tokko_id: 6596706, reference_code: "ZHO6596706", operation: "sale", property_type: "Casa", title: "Casa",
  description: "", price: 95000, currency: "USD", expenses: null, zone: "Rio Ceballos", rooms: 4, bedrooms: 3, bathrooms: 2,
  surface_total: null, surface_covered: null, pets_allowed: null, amenities: [], public_url: null,
  web_url: "https://inmobiliariazavalaseppey.com.ar/propiedad/casa-3-dormitorios-en-venta-rio-ceballos-6596706/" } as PublicRow;
const ev = (value: unknown) => ({ value, quote: "q" });

describe("matcher (código)", () => {
  it("coincide y explica cada criterio", () => {
    const r = matchReasons(P, { property_type: ev("casa"), zones: ev(["Río Ceballos"]), budget_max: ev(100000), budget_currency: ev("USD"), rooms_min: ev(2) });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([
      "Tipo: busca casa y es Casa", "Zona: busca en Río Ceballos y está en Rio Ceballos",
      "Precio: USD 95.000 y su presupuesto es USD 100.000", "Dormitorios: necesita 2 y tiene 3",
    ]);
  });
  it("hasta un 10 % arriba del presupuesto se acepta y se avisa", () => {
    const r = matchReasons(P, { property_type: ev("casa"), budget_max: ev(90000) });
    expect(r.ok).toBe(true);
    expect(r.reasons[1]).toContain("6 % arriba");
    expect(matchReasons(P, { property_type: ev("casa"), budget_max: ev(80000) }).ok).toBe(false);
  });
  it("cualquier dato que no cumple descarta", () => {
    const base: Profile = { property_type: ev("casa"), budget_max: ev(100000) };
    expect(matchReasons(P, { ...base, zones: ev(["Unquillo"]) }).ok).toBe(false);
    expect(matchReasons(P, { ...base, property_type: ev("terreno") }).ok).toBe(false);
    expect(matchReasons(P, { ...base, budget_currency: ev("ARS") }).ok).toBe(false);
    expect(matchReasons(P, { ...base, rooms_min: ev(4) }).ok).toBe(false);
    expect(matchReasons(P, { ...base, operation: ev("rent") }).ok).toBe(false);
  });
  it("con un solo criterio conocido no alcanza (evita avisar a todos)", () => {
    expect(matchReasons(P, { zones: ev(["Río Ceballos"]) }).ok).toBe(false);
    expect(matchReasons(P, {}).ok).toBe(false);
  });
});

describe("texto del aviso y plantilla", () => {
  it("el aviso lleva resumen y link de la web", () => {
    const t = proactiveText(P);
    expect(t).toContain("casa de 3 dormitorios en Rio Ceballos, USD 95.000");
    expect(t).toContain(P.web_url!);
  });
  it("la plantilla renderizada es igual al aviso (el chat muestra lo que recibió)", () => {
    expect(renderTemplate(templateParams(P))).toBe(proactiveText(P));
    expect(PROPERTY_TEMPLATE.buttons.map((b) => b.payload)).toEqual(["INFO", "OPT_OUT"]);
  });
});

describe("permiso para avisos", () => {
  it("es la última pregunta de seguimiento y no se repite", () => {
    const all = new Set(["credit", "sell", "purpose", "bedrooms", "name"]);
    expect(nextFollowUp({ hasName: false, housing: true }, all)).toBe("alerts");
    expect(nextFollowUp({ hasName: false, housing: true, alerts: false }, all)).toBeNull();
    expect(nextFollowUp({ hasName: false, housing: true }, new Set([...all, "alerts"]))).toBeNull();
  });
});

describe("plantilla en Meta", () => {
  it("manda nombre, idioma, parámetros y payloads de los botones", async () => {
    let sent: Record<string, any> | undefined;
    const f = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify({ messages: [{ id: "wamid.T" }] })); }) as unknown as typeof fetch;
    const c = new MetaClient({ accessToken: "T", graphVersion: "v26.0", fetchImpl: f });
    expect(await c.sendTemplate("PNID", "549351", { name: "aviso_propiedad", language: "es_AR", params: ["a", "b"], buttons: ["INFO", "OPT_OUT"] })).toBe("wamid.T");
    expect(sent).toMatchObject({ type: "template", template: { name: "aviso_propiedad", language: { code: "es_AR" } } });
    expect(sent!.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "INFO" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "OPT_OUT" }] },
    ]);
  });
  it("el botón que tocó el cliente llega con su payload", () => {
    const r = parseMetaWebhook({ object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "PNID" },
      messages: [{ from: "549351", id: "wamid.B", timestamp: "1762700000", type: "button", button: { text: "No quiero recibir más", payload: "OPT_OUT" } }] } }] }] })!;
    expect(r.inbound[0]).toMatchObject({ kind: "text", body: "No quiero recibir más", buttonPayload: "OPT_OUT" });
  });
  it("una plantilla sale aunque hayan pasado las 24 h; el texto libre no", async () => {
    const calls: string[] = [];
    const jobs = [
      { id: "o1", conversation_id: "c1", to_phone: "549351@s.whatsapp.net", body: "x", attempts: 1, template: { name: "aviso_propiedad", language: "es_AR", params: ["a", "b"] } },
      { id: "o2", conversation_id: "c1", to_phone: "549351@s.whatsapp.net", body: "x", attempts: 1, template: null },
    ];
    const q = (data: unknown) => { const ch: Record<string, unknown> = {}; for (const k of ["select", "eq", "order", "limit"]) ch[k] = () => ch; ch.maybeSingle = async () => ({ data }); return ch; };
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push(`${fn}:${args.p_ok ?? ""}`); return { data: fn === "claim_outbound" ? (jobs.length ? [jobs.shift()] : []) : null, error: null }; },
      from: (t: string) => t === "messages" ? q({ created_at: "2026-11-01T00:00:00Z" }) : q({ contact: { is_test: false } }),
    };
    const client = { sendTemplate: async () => "wamid.T", sendText: async () => "wamid.X" } as unknown as MetaClient;
    const r = await drainMetaOutbound(db as never, client, { id: "ch", slug: "ventas", meta_phone_number_id: "PNID" }, { now: () => Date.parse("2026-11-13T12:00:00Z") });
    expect(r).toEqual({ sent: 1, failed: 1 });
  });
});

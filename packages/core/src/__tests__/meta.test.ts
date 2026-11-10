import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MetaApiError, MetaClient, parseMetaWebhook, verifyMetaSignature } from "../transport/meta";
import { drainMetaOutbound, WINDOW_CLOSED_ERROR } from "../transport/meta-dispatch";

const SECRET = "secreto-de-prueba";
const sign = (raw: string) => "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex");

const hook = (field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PNID", display_phone_number: "54351" }, ...value } }] }],
});

describe("firma del webhook de Meta", () => {
  it("acepta la firma correcta y rechaza el resto", () => {
    const raw = JSON.stringify({ a: 1 });
    expect(verifyMetaSignature(SECRET, sign(raw), raw)).toBe(true);
    expect(verifyMetaSignature(SECRET, sign(raw), raw + " ")).toBe(false);
    expect(verifyMetaSignature(SECRET, null, raw)).toBe(false);
    expect(verifyMetaSignature(undefined, sign(raw), raw)).toBe(false);
    expect(verifyMetaSignature(SECRET, "sha256=abc", raw)).toBe(false);
  });
});

describe("lectura del webhook", () => {
  it("texto y audio del cliente, con nombre", () => {
    const r = parseMetaWebhook(hook("messages", {
      contacts: [{ wa_id: "5493510000001", profile: { name: "Ana" } }],
      messages: [
        { from: "5493510000001", id: "wamid.1", timestamp: "1762700000", type: "text", text: { body: "hola" } },
        { from: "5493510000001", id: "wamid.2", timestamp: "1762700001", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus", voice: true } },
      ],
    }))!;
    expect(r.inbound).toHaveLength(2);
    expect(r.inbound[0]).toMatchObject({ phoneNumberId: "PNID", phone: "5493510000001", displayName: "Ana", fromMe: false, kind: "text", body: "hola", mediaId: null });
    expect(r.inbound[0].sentAt.toISOString()).toBe(new Date(1762700000 * 1000).toISOString());
    expect(r.inbound[1]).toMatchObject({ kind: "audio", mediaId: "MEDIA1", body: null });
  });
  it("eco de la app del teléfono (coexistencia): from_me hacia el cliente", () => {
    const r = parseMetaWebhook(hook("smb_message_echoes", {
      message_echoes: [{ from: "54351", to: "5493510000001", id: "wamid.3", timestamp: "1762700002", type: "text", text: { body: "te llamo" } }],
    }))!;
    expect(r.inbound[0]).toMatchObject({ phone: "5493510000001", fromMe: true, displayName: null, body: "te llamo" });
  });
  it("reacciones no van a la bandeja; botones y tipos raros sí", () => {
    const r = parseMetaWebhook(hook("messages", {
      messages: [
        { from: "1", id: "a", timestamp: "1", type: "reaction" },
        { from: "1", id: "b", timestamp: "1", type: "interactive", interactive: { button_reply: { title: "Sí" } } },
        { from: "1", id: "c", timestamp: "1", type: "unsupported" },
      ],
    }))!;
    expect(r.inbound.map((m) => [m.waMessageId, m.kind, m.body])).toEqual([["b", "text", "Sí"], ["c", "other", null]]);
  });
  it("estados: solo interesan los fallidos", () => {
    const r = parseMetaWebhook(hook("messages", {
      statuses: [
        { id: "wamid.9", status: "delivered", recipient_id: "1" },
        { id: "wamid.8", status: "failed", recipient_id: "1", errors: [{ code: 131047, title: "Re-engagement message" }] },
      ],
    }))!;
    expect(r.failures).toEqual([{ waMessageId: "wamid.8", error: "meta 131047: Re-engagement message" }]);
  });
  it("otro objeto o forma inválida: null", () => {
    expect(parseMetaWebhook({ object: "page", entry: [] })).toBeNull();
    expect(parseMetaWebhook({ nada: 1 })).toBeNull();
  });
});

describe("cliente de Meta", () => {
  let last: { url: string; init?: RequestInit } | undefined;
  const fakeFetch = (status: number, body: unknown): typeof fetch =>
    (async (url: string, init?: RequestInit) => {
      last = { url: String(url), init };
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;

  it("envía texto y devuelve el wamid", async () => {
    const c = new MetaClient({ accessToken: "T", graphVersion: "v26.0", fetchImpl: fakeFetch(200, { messages: [{ id: "wamid.X" }] }) });
    expect(await c.sendText("PNID", "549351@s.whatsapp.net", "hola")).toBe("wamid.X");
    expect(last?.url).toBe("https://graph.facebook.com/v26.0/PNID/messages");
    expect(JSON.parse(String(last?.init?.body))).toMatchObject({ to: "549351", type: "text", text: { body: "hola" } });
  });
  it("error de ventana de 24 h: permanente", async () => {
    const c = new MetaClient({ accessToken: "T", graphVersion: "v26.0", fetchImpl: fakeFetch(400, { error: { code: 131047, message: "Re-engagement" } }) });
    const e = await c.sendText("PNID", "1", "x").catch((x) => x);
    expect(e).toBeInstanceOf(MetaApiError);
    expect(e.permanent).toBe(true);
  });
  it("error temporal: se reintenta", async () => {
    const c = new MetaClient({ accessToken: "T", graphVersion: "v26.0", fetchImpl: fakeFetch(500, { error: { code: 131000, message: "algo" } }) });
    expect((await c.sendText("PNID", "1", "x").catch((x) => x)).permanent).toBe(false);
  });
});

// ───────── Despacho con una base falsa ─────────
function fakeDb(opts: { jobs: { id: string; conversation_id: string; to_phone: string; body: string; attempts: number }[]; lastClient: string | null; isTest?: boolean }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const queue = [...opts.jobs];
  const q = (data: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order", "limit"]) chain[k] = () => chain;
    chain.maybeSingle = async () => ({ data });
    return chain;
  };
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "claim_outbound") return { data: queue.length ? [queue.shift()] : [], error: null };
      return { data: null, error: null };
    },
    from: (t: string) => t === "messages"
      ? q(opts.lastClient ? { created_at: opts.lastClient } : null)
      : q({ contact: { is_test: !!opts.isTest } }),
  };
}
const job = { id: "o1", conversation_id: "c1", to_phone: "5493510000001@s.whatsapp.net", body: "hola", attempts: 1 };
const ch = { id: "ch", slug: "ventas", meta_phone_number_id: "PNID" };
const NOW = Date.parse("2026-11-10T12:00:00Z");
const okClient = (sent: string[]) => ({ sendText: async (_p: string, to: string) => { sent.push(to); return "wamid.OK"; } }) as unknown as MetaClient;

describe("despacho por Meta", () => {
  it("dentro de las 24 h: envía y marca enviado", async () => {
    const db = fakeDb({ jobs: [job], lastClient: "2026-11-10T08:00:00Z" });
    const sent: string[] = [];
    const r = await drainMetaOutbound(db as never, okClient(sent), ch, { now: () => NOW });
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual(["5493510000001"]);
    expect(db.calls.find((c) => c.fn === "mark_outbound_result")?.args).toMatchObject({ p_ok: true, p_wa_message_id: "wamid.OK" });
  });
  it("pasadas las 24 h: no llama a Meta y falla de una", async () => {
    const db = fakeDb({ jobs: [job], lastClient: "2026-11-09T08:00:00Z" });
    const sent: string[] = [];
    const r = await drainMetaOutbound(db as never, okClient(sent), ch, { now: () => NOW });
    expect(r.failed).toBe(1);
    expect(sent).toEqual([]);
    expect(db.calls.find((c) => c.fn === "mark_outbound_result")?.args).toMatchObject({ p_ok: false, p_error: WINDOW_CLOSED_ERROR, p_max_attempts: 0 });
  });
  it("contacto de prueba: nunca sale por WhatsApp real", async () => {
    const db = fakeDb({ jobs: [job], lastClient: "2026-11-10T08:00:00Z", isTest: true });
    const sent: string[] = [];
    await drainMetaOutbound(db as never, okClient(sent), ch, { now: () => NOW });
    expect(sent).toEqual([]);
    expect(db.calls.find((c) => c.fn === "mark_outbound_result")?.args).toMatchObject({ p_ok: false, p_max_attempts: 0 });
  });
  it("error permanente de Meta: falla sin reintentos", async () => {
    const db = fakeDb({ jobs: [job], lastClient: "2026-11-10T08:00:00Z" });
    const client = { sendText: async () => { throw new MetaApiError("meta 131026: undeliverable", 131026, 400); } } as unknown as MetaClient;
    await drainMetaOutbound(db as never, client, ch, { now: () => NOW });
    expect(db.calls.find((c) => c.fn === "mark_outbound_result")?.args).toMatchObject({ p_ok: false, p_max_attempts: 0 });
  });
  it("antes de empezar, marca los envíos que quedaron colgados", async () => {
    const db = fakeDb({ jobs: [], lastClient: null });
    await drainMetaOutbound(db as never, okClient([]), ch, { now: () => NOW });
    expect(db.calls[0]).toEqual({ fn: "fail_stale_sending", args: { p_channel_id: "ch", p_seconds: 120 } });
  });
});

import { describe, it, expect } from "vitest";
import { sign, signedHeaders, verify, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../transport/hmac";
import { InboundPayload } from "../transport/inbound";

const SECRET = "s3cr3t";
const body = JSON.stringify({ hola: "mundo" });

describe("hmac", () => {
  it("acepta una firma válida", () => {
    const h = signedHeaders(SECRET, body, 1_000_000);
    expect(verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, 1_000_000)).toEqual({ ok: true });
  });
  it("rechaza si cambia el cuerpo", () => {
    const h = signedHeaders(SECRET, body, 1_000_000);
    expect(verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body + " ", 1_000_000)).toMatchObject({ reason: "bad_signature" });
  });
  it("rechaza otro secreto", () => {
    const h = signedHeaders("otro", body, 1_000_000);
    expect(verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, 1_000_000)).toMatchObject({ reason: "bad_signature" });
  });
  it("rechaza una petición vieja (reenvío)", () => {
    const h = signedHeaders(SECRET, body, 1_000_000);
    expect(verify(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, 1_000_000 + 6 * 60_000)).toMatchObject({ reason: "stale" });
  });
  it("rechaza sin headers, sin secreto o con firma de otro largo", () => {
    expect(verify(SECRET, null, null, body)).toMatchObject({ reason: "missing" });
    expect(verify(undefined, "1", "aa", body)).toMatchObject({ reason: "no_secret" });
    const ts = String(Date.now());
    expect(verify(SECRET, ts, "abcd", body)).toMatchObject({ reason: "bad_signature" });
    expect(sign(SECRET, ts, body)).toHaveLength(64);
  });
});

describe("InboundPayload", () => {
  const ok = {
    channel_slug: "ventas", wa_message_id: "ABC", phone: "5493511234567", wa_jid: "5493511234567@s.whatsapp.net",
    display_name: null, from_me: false, kind: "text", body: "hola", media_path: null, sent_at: new Date().toISOString(),
  };
  it("acepta un mensaje válido", () => expect(InboundPayload.safeParse(ok).success).toBe(true));
  it("rechaza un tipo desconocido", () => expect(InboundPayload.safeParse({ ...ok, kind: "poll" }).success).toBe(false));
});

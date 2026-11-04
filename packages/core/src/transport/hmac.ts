import { createHmac, timingSafeEqual } from "node:crypto";

// Firma entre el worker (Railway) y la web (Vercel).
// Se firma "timestamp.cuerpo" para que una petición capturada no se pueda reenviar más tarde.

export const SIGNATURE_HEADER = "x-inmo-signature";
export const TIMESTAMP_HEADER = "x-inmo-timestamp";
const MAX_SKEW_MS = 5 * 60 * 1000;

export function sign(secret: string, timestamp: string, body: string): string {
  if (!secret) throw new Error("Falta INBOUND_HMAC_SECRET");
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Headers listos para mandar un cuerpo firmado. */
export function signedHeaders(secret: string, body: string, now = Date.now()): Record<string, string> {
  const ts = String(now);
  return { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sign(secret, ts, body), "content-type": "application/json" };
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "bad_signature" | "no_secret" };

export function verify(
  secret: string | undefined, timestamp: string | null, signature: string | null, body: string, now = Date.now(),
): VerifyResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!timestamp || !signature) return { ok: false, reason: "missing" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return { ok: false, reason: "stale" };
  const expected = Buffer.from(sign(secret, timestamp, body), "hex");
  const got = Buffer.from(signature, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

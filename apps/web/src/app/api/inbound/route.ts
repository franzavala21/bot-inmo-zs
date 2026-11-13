import { after, NextResponse } from "next/server";
import { adminClient, InboundPayload, notifyHandoff, runBotTurn, verify, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@inmo/core";

// El turno del bot corre después de responder al worker (after). Tope por si el modelo tarda.
export const maxDuration = 60;
// Espera antes de responder: la gente manda varios mensajes seguidos y se contestan juntos.
const DEBOUNCE_MS = 7_000;

// Recibe del worker (Railway) cada mensaje de WhatsApp. Público en el middleware: lo protege la firma HMAC.
// Privacidad: en los logs va solo el id de conversación, nunca teléfono ni texto.
export async function POST(req: Request) {
  const raw = await req.text();
  const check = verify(process.env.INBOUND_HMAC_SECRET, req.headers.get(TIMESTAMP_HEADER), req.headers.get(SIGNATURE_HEADER), raw);
  if (!check.ok) {
    console.warn("[inbound] firma rechazada:", check.reason);
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "json inválido" }, { status: 400 }); }
  const parsed = InboundPayload.safeParse(json);
  if (!parsed.success) {
    console.warn("[inbound] payload inválido:", parsed.error.issues.map((i) => i.path.join(".")).join(","));
    return NextResponse.json({ error: "payload inválido" }, { status: 400 });
  }
  const p = parsed.data;

  const { data, error } = await adminClient().rpc("ingest_inbound", {
    p_channel_slug: p.channel_slug, p_wa_message_id: p.wa_message_id, p_phone: p.phone, p_wa_jid: p.wa_jid,
    p_display_name: p.display_name, p_from_me: p.from_me, p_kind: p.kind, p_body: p.body,
    p_media_path: p.media_path, p_sent_at: p.sent_at,
  });
  if (error) {
    console.error("[inbound] error al guardar:", error.code, error.message);
    return NextResponse.json({ error: "no se pudo guardar" }, { status: 500 });
  }
  const r = data as { conversation_id: string; message_id: string | null; duplicate: boolean };
  console.log("[inbound] ok conv=%s dup=%s", r.conversation_id, r.duplicate);
  // Bot: solo mensajes nuevos del cliente. claim_bot_turn decide si corresponde (bot prendido, modo IA, último mensaje).
  if (!r.duplicate && !p.from_me && r.message_id) {
    const messageId = r.message_id;
    after(async () => {
      await new Promise((res) => setTimeout(res, DEBOUNCE_MS));
      try {
        const result = await runBotTurn(adminClient(), r.conversation_id, messageId);
        console.log("[bot] conv=%s resultado=%s", r.conversation_id, result);
        if (result === "handoff") await notifyHandoff(adminClient(), r.conversation_id);
      } catch (e) {
        console.error("[bot] conv=%s falló: %s", r.conversation_id, (e as Error).message);
      }
    });
  }
  return NextResponse.json(r);
}

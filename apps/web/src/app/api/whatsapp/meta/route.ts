import { after, NextResponse } from "next/server";
import {
  adminClient, channelByPhoneNumberId, drainForConversation, ingestMetaInbound, MetaClient, metaConfigFromEnv,
  META_SIGNATURE_HEADER, notifyHandoff, parseMetaWebhook, runBotTurn, updateLead, verifyMetaSignature,
} from "@inmo/core";

// Webhook de la API oficial de WhatsApp (Meta). Público en el middleware: lo protege la firma con el App Secret.
// Privacidad: en los logs van solo ids, nunca teléfono ni texto.
export const maxDuration = 60;
const DEBOUNCE_MS = 7_000;

// Meta verifica la URL una vez al configurar el webhook.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.META_VERIFY_TOKEN;
  if (u.searchParams.get("hub.mode") === "subscribe" && token && u.searchParams.get("hub.verify_token") === token) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "verificación inválida" }, { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(process.env.META_APP_SECRET, req.headers.get(META_SIGNATURE_HEADER), raw)) {
    console.warn("[meta] firma rechazada");
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "json inválido" }, { status: 400 }); }
  const events = parseMetaWebhook(json);
  // Otros campos (cuenta, plantillas, etc.): se acusa recibo para que Meta no reintente.
  if (!events) return NextResponse.json({ ok: true, ignored: true });

  const cfg = metaConfigFromEnv();
  if (!cfg) {
    console.error("[meta] falta META_ACCESS_TOKEN");
    return NextResponse.json({ error: "sin configurar" }, { status: 500 });
  }
  const db = adminClient();
  const client = new MetaClient(cfg);

  for (const f of events.failures) {
    const { error } = await db.rpc("mark_delivery_failed", { p_wa_message_id: f.waMessageId, p_error: f.error });
    if (error) console.error("[meta] no se pudo anotar un envío no entregado: %s", error.code);
  }

  // Se guarda todo ANTES de responder: si algo falla, Meta reintenta y ingest_inbound no duplica.
  const botTurns: { conv: string; msg: string }[] = [];
  for (const m of events.inbound) {
    const ch = await channelByPhoneNumberId(db, m.phoneNumberId);
    if (!ch) { console.warn("[meta] número de Meta sin canal asignado"); continue; }
    try {
      const r = await ingestMetaInbound(db, client, ch, m);
      console.log("[meta] ok conv=%s dup=%s eco=%s", r.conversation_id, r.duplicate, m.fromMe);
      if (!r.duplicate && !m.fromMe && r.message_id) botTurns.push({ conv: r.conversation_id, msg: r.message_id });
    } catch (e) {
      console.error("[meta] error al guardar: %s", (e as Error).message.slice(0, 160));
      return NextResponse.json({ error: "no se pudo guardar" }, { status: 500 });
    }
  }

  // Bot: igual que /api/inbound. claim_bot_turn decide si corresponde; después se envía lo que quedó en cola.
  for (const t of botTurns) {
    after(async () => {
      await new Promise((res) => setTimeout(res, DEBOUNCE_MS));
      try {
        const result = await runBotTurn(adminClient(), t.conv, t.msg);
        console.log("[bot] conv=%s resultado=%s", t.conv, result);
        if (result === "handoff") await notifyHandoff(adminClient(), t.conv);
      } catch (e) {
        console.error("[bot] conv=%s falló: %s", t.conv, (e as Error).message);
      }
      const sent = await drainForConversation(adminClient(), new MetaClient(cfg), t.conv).catch((e) => {
        console.error("[meta] envío falló conv=%s: %s", t.conv, (e as Error).message.slice(0, 160)); return null;
      });
      if (sent) console.log("[meta] cola conv=%s enviados=%d fallidos=%d", t.conv, sent.sent, sent.failed);
      // Ficha y puntaje del lead: corre siempre (también con el bot apagado o el chat en manos de una persona).
      const lead = await updateLead(adminClient(), t.conv, { messageId: t.msg });
      console.log("[lead] conv=%s resultado=%s", t.conv, lead);
    });
  }
  return NextResponse.json({ ok: true });
}

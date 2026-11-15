import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { adminClient, leadsFromInquiries, parseTokkoInquiry } from "@inmo/core";

// Recibe los emails "Nueva consulta" de Tokko que manda el script de Google Apps Script (scripts/gmail-tokko.gs).
// Público en el middleware: lo protege EMAIL_INGEST_SECRET. Privacidad: no se loguea nada del contenido.
export const maxDuration = 30;
const MAX = 25;

function authorized(header: string | null): boolean {
  const secret = process.env.EMAIL_INGEST_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  let body: { messages?: { id?: string; date?: string; html?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "json inválido" }, { status: 400 }); }
  const msgs = (body.messages ?? []).filter((m) => m.id && m.html).slice(0, MAX);
  const rows = msgs.map((m) => {
    const r = parseTokkoInquiry(m.html!);
    return {
      gmail_message_id: m.id!, received_at: m.date && !Number.isNaN(Date.parse(m.date)) ? new Date(m.date).toISOString() : new Date().toISOString(),
      name: r.name, email: r.email, phone: r.phone, tags: r.tags, message: r.message,
      property_codes: r.propertyCodes, property_title: r.propertyTitle, webcontact_id: r.webcontactId,
    };
  });
  let created = 0;
  if (rows.length) {
    const db = adminClient();
    // Solo vuelven las filas nuevas (las repetidas se ignoran): cada aviso se procesa una vez.
    const { data: inserted, error } = await db.from("portal_inquiries")
      .upsert(rows, { onConflict: "gmail_message_id", ignoreDuplicates: true }).select("name, email, phone, tags, received_at");
    if (error) { console.error("[email] no se pudo guardar: %s", error.code); return NextResponse.json({ error: "no se pudo guardar" }, { status: 500 }); }
    // Del más viejo al más nuevo: si alguien consultó dos veces, la segunda ya encuentra la primera.
    created = await leadsFromInquiries(db, [...(inserted ?? [])].sort((a, b) => a.received_at.localeCompare(b.received_at)));
  }
  console.log("[email] consultas de Tokko recibidas=%d con_propiedad=%d consultas_nuevas=%d", rows.length, rows.filter((r) => r.property_codes.length).length, created);
  return NextResponse.json({ ok: true, saved: rows.length, created });
}

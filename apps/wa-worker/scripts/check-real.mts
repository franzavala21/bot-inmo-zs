import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const since = new Date(Date.now() - 60 * 60_000).toISOString();
const { data: convs } = await db.from("conversations").select("id, mode, needs_attention, attention_reason, last_message_at, contacts!inner(is_test, wa_jid)").eq("contacts.is_test", false).gte("last_message_at", since);
for (const c of convs ?? []) {
  const jid = (c as any).contacts.wa_jid as string | null;
  console.log(`\nCONV ${c.id} mode=${c.mode} attention=${c.needs_attention} ${c.attention_reason ?? ""} jid_tipo=${jid?.split("@")[1] ?? "-"}`);
  const { data: msgs } = await db.from("messages").select("id, author, kind, body, media_path, wa_message_id, created_at").eq("conversation_id", c.id).order("created_at");
  const { data: outs } = await db.from("outbound_messages").select("message_id, status, attempts, error, sent_at").eq("conversation_id", c.id);
  for (const m of msgs ?? []) {
    const o = outs?.find((x) => x.message_id === m.id);
    console.log(`  ${m.created_at.slice(11, 19)} ${m.author.padEnd(6)} ${m.kind.padEnd(5)} texto=${m.body ? m.body.length + "c" : "-"} media=${m.media_path ? "sí" : "-"} wa_id=${m.wa_message_id ? "sí" : "-"}${o ? ` envío=${o.status} intentos=${o.attempts}${o.error ? " err=" + o.error : ""}` : ""}`);
  }
  const { data: aud } = await db.from("audit_log").select("event, summary, created_at").eq("conversation_id", c.id).order("created_at");
  for (const a of aud ?? []) console.log(`  audit ${a.created_at.slice(11, 19)} ${a.event}: ${a.summary}`);
  for (const m of msgs ?? []) if (m.media_path) {
    const s = await db.storage.from("media").createSignedUrl(m.media_path, 60);
    const r = s.data ? await fetch(s.data.signedUrl) : null;
    console.log(`  media ${m.kind}: ${r?.status} ${r?.headers.get("content-type")} ${r?.headers.get("content-length")} bytes`);
  }
}

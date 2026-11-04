// Prueba de punta a punta sin chip. Requiere: web en WEB_BASE_URL y worker con WA_TRANSPORT=fake.
// Usa un contacto de prueba (is_test=true). No borra nada.
import { createClient } from "@supabase/supabase-js";
import { signedHeaders } from "@inmo/core/transport/hmac";
const base = process.env.E2E_BASE ?? "http://localhost:3001";
const secret = process.env.INBOUND_HMAC_SECRET!;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PHONE = "5490000000001";
let fails = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "OK  " : "FALLA"} ${name} ${extra}`); if (!ok) fails++; };

async function post(payload: object, opts: { badSig?: boolean; oldTs?: boolean } = {}) {
  const body = JSON.stringify(payload);
  const h = signedHeaders(secret, body, opts.oldTs ? Date.now() - 10 * 60_000 : Date.now()) as Record<string, string>;
  if (opts.badSig) h["x-inmo-signature"] = "0".repeat(64);
  const r = await fetch(`${base}/api/inbound`, { method: "POST", headers: { "content-type": "application/json", ...h }, body });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const msg = (id: string, fromMe = false, body = "Hola, consulto por la casa (mensaje de prueba)") => ({
  channel_slug: "ventas", wa_message_id: id, phone: PHONE, wa_jid: `${PHONE}@s.whatsapp.net`, display_name: "Prueba E2E",
  from_me: fromMe, kind: "text", body, media_path: null, sent_at: new Date().toISOString(),
});

const run = Date.now();
check("firma inválida → 401", (await post(msg(`E2E-${run}-x`), { badSig: true })).status === 401);
check("firma vieja → 401", (await post(msg(`E2E-${run}-y`), { oldTs: true })).status === 401);
check("payload inválido → 400", (await post({ hola: 1 })).status === 400);

const a = await post(msg(`E2E-${run}-1`));
check("mensaje entrante → 200", a.status === 200, JSON.stringify(a.json));
const convId = a.json?.conversation_id as string;
const b = await post(msg(`E2E-${run}-1`));
check("reintento → duplicado, no se repite", b.status === 200 && b.json?.duplicate === true);

await db.from("contacts").update({ is_test: true }).eq("phone", PHONE);
const { data: m } = await db.from("messages").select("id").eq("conversation_id", convId).eq("wa_message_id", `E2E-${run}-1`);
check("mensaje guardado una sola vez", m?.length === 1);
const { data: aud } = await db.from("audit_log").select("event").eq("conversation_id", convId).eq("details->>message_id", m?.[0]?.id ?? "");
check("audit_log 'inbound' escrito", aud?.some((x) => x.event === "inbound") ?? false);

// Dejarlo en modo IA para probar el pase a humano.
await db.rpc("set_conversation_mode", { p_conversation_id: convId, p_mode: "ai", p_user: null });

// Un dueño responde desde el panel.
const { data: users } = await db.auth.admin.listUsers();
const owner = users.users[0]?.id;
const r = await db.rpc("human_reply", { p_conversation_id: convId, p_body: "Hola, gracias por escribir (respuesta de prueba)", p_user: owner });
check("human_reply encola", !r.error, r.error?.message ?? "");
const outId = r.data as string;
let st = "";
for (let i = 0; i < 30; i++) {
  const { data } = await db.from("outbound_messages").select("status").eq("id", outId).single();
  st = data?.status ?? "";
  if (st === "sent" || st === "failed") break;
  await new Promise((res) => setTimeout(res, 1000));
}
check("el worker lo despachó (sent)", st === "sent", `estado=${st}`);
const { data: om } = await db.from("outbound_messages").select("message_id").eq("id", outId).single();
const { data: sm } = await db.from("messages").select("wa_message_id").eq("id", om!.message_id).single();
check("messages.wa_message_id cargado", !!sm?.wa_message_id?.startsWith("FAKE-"), sm?.wa_message_id ?? "");
let { data: conv } = await db.from("conversations").select("mode").eq("id", convId).single();
check("responder desde el panel pasa a humano", conv?.mode === "human");

// Un dueño escribe desde el teléfono del chip con el chat en IA.
await db.rpc("set_conversation_mode", { p_conversation_id: convId, p_mode: "ai", p_user: owner });
const c = await post(msg(`E2E-${run}-2`, true, "Te escribo desde el teléfono (prueba)"));
({ data: conv } = await db.from("conversations").select("mode").eq("id", convId).single());
check("escribir desde el teléfono pasa a humano", c.status === 200 && conv?.mode === "human");

const { data: ch } = await db.from("channels").select("worker_status, worker_heartbeat_at").eq("slug", "ventas").single();
check("canal 'online' con heartbeat", ch?.worker_status === "online", JSON.stringify(ch));
console.log(fails ? `\n${fails} FALLAS` : "\nTodo OK");
process.exit(fails ? 1 : 0);

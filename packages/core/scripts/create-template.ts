// Crea en Meta una plantilla: "avisos" (PROPERTY_TEMPLATE, avisos de propiedades) o "portal" (PORTAL_TEMPLATE, consultas de portales).
// Meta la revisa (de minutos a un par de días). El texto sale de src/leads/matcher.ts: el mismo que se guarda en el chat.
// Uso: cd packages/core && node_modules/.bin/tsx --env-file=../../.env scripts/create-template.ts [avisos|portal|portal_prop|seguimiento] [--estado]
import { PROPERTY_TEMPLATE as AVISOS } from "../src/leads/matcher";
import { PORTAL_PROPERTY_TEMPLATE, PORTAL_TEMPLATE } from "../src/tokko/portal";
import { FOLLOW_UP_TEMPLATE } from "../src/leads/followups";
const PROPERTY_TEMPLATE = process.argv.includes("seguimiento") ? FOLLOW_UP_TEMPLATE : process.argv.includes("portal_prop") ? PORTAL_PROPERTY_TEMPLATE : process.argv.includes("portal") ? PORTAL_TEMPLATE : AVISOS;

const token = process.env.META_ACCESS_TOKEN;
const waba = process.env.META_WABA_ID ?? "2661699917608139";
const v = process.env.META_GRAPH_VERSION ?? "v26.0";
if (!token) throw new Error("Falta META_ACCESS_TOKEN");
const api = (path: string, init?: RequestInit) =>
  fetch(`https://graph.facebook.com/${v}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } })
    .then(async (r) => ({ status: r.status, json: await r.json() }));

if (process.argv.includes("--estado")) {
  const r = await api(`${waba}/message_templates?name=${PROPERTY_TEMPLATE.name}&fields=name,status,language,category,rejected_reason`);
  console.log(JSON.stringify(r.json?.data ?? r.json, null, 1));
} else {
  const r = await api(`${waba}/message_templates`, {
    method: "POST",
    body: JSON.stringify({
      name: PROPERTY_TEMPLATE.name, language: PROPERTY_TEMPLATE.language, category: PROPERTY_TEMPLATE.category,
      components: [
        { type: "BODY", text: PROPERTY_TEMPLATE.body, example: { body_text: [PROPERTY_TEMPLATE.example] } },
        { type: "BUTTONS", buttons: PROPERTY_TEMPLATE.buttons.map((b) => ({ type: "QUICK_REPLY", text: b.text })) },
      ],
    }),
  });
  console.log(r.status, JSON.stringify(r.json));
}

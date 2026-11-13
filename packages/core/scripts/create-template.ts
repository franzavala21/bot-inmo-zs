// Crea en Meta la plantilla de avisos de propiedades (PROPERTY_TEMPLATE), para mandar fuera de las 24 h.
// Meta la revisa (de minutos a un par de días). El texto sale de src/leads/matcher.ts: el mismo que se guarda en el chat.
// Uso: cd packages/core && node_modules/.bin/tsx --env-file=../../.env scripts/create-template.ts [--estado]
import { PROPERTY_TEMPLATE } from "../src/leads/matcher";

const token = process.env.META_ACCESS_TOKEN;
const waba = process.env.META_WABA_ID ?? "1859520905073768";
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

// Uso: pnpm --filter @inmo/core tokko:probe   (lee TOKKO_API_KEY del .env raíz)
// Muestra cuántas propiedades hay y la FORMA de los datos, para validar el mapeo. No imprime la clave.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TokkoClient } from "../src/tokko/client";
import { mapTokkoProperty } from "../src/tokko/mapper";

try {
  for (const line of readFileSync(resolve(import.meta.dirname, "../../../.env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const items = await new TokkoClient(process.env.TOKKO_API_KEY ?? "").listAllProperties();
console.log(`Propiedades en Tokko: ${items.length}`);
const ops = new Map<string, number>();
for (const p of items) for (const o of p.operations ?? []) ops.set(o.operation_type ?? "?", (ops.get(o.operation_type ?? "?") ?? 0) + 1);
console.log("Operaciones:", Object.fromEntries(ops));
console.log("Campos del primer objeto:", Object.keys(items[0] ?? {}).sort().join(", "));
const tags = new Set(items.flatMap((p) => (p.tags ?? []).map((t) => t.name)));
console.log("Tags usados:", [...tags].slice(0, 80).join(" | "));
const sample = mapTokkoProperty(items[0]);
const { raw, address, ...rest } = sample;
console.log("Ejemplo mapeado (sin dirección ni raw):", rest);

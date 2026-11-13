// Convierte packages/core/prompts/*.md en src/bot/prompts.generated.ts (texto embebido en el código).
// Así el prompt se edita como .md y funciona igual en Vercel, en los tests y en los scripts, sin leer archivos en runtime.
// Uso: pnpm --filter @inmo/core prompts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "prompts");

/** Saca los comentarios <!-- --> (notas para quien edita) y los espacios de más. */
export function cleanPrompt(md: string): string {
  return md.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderGenerated(): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const entries = files.map((f) => `  ${JSON.stringify(basename(f, ".md"))}: ${JSON.stringify(cleanPrompt(readFileSync(join(dir, f), "utf8")))},`);
  return [
    "// GENERADO por scripts/build-prompts.ts a partir de prompts/*.md. NO EDITAR A MANO: editá el .md y corré `pnpm --filter @inmo/core prompts`.",
    "export const PROMPTS = {",
    ...entries,
    "} as const;",
    "",
  ].join("\n");
}

export const GENERATED_PATH = join(root, "src/bot/prompts.generated.ts");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(GENERATED_PATH, renderGenerated());
  console.log("prompts generados:", GENERATED_PATH);
}

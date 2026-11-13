import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDrafterPrompt, DRAFTER_REQUIRED } from "../bot/agents";
import { PROMPTS } from "../bot/prompts.generated";
import { GENERATED_PATH, renderGenerated } from "../../scripts/build-prompts";

describe("prompts en .md", () => {
  it("prompts.generated.ts está al día con los .md (si falla: pnpm --filter @inmo/core prompts)", () => {
    expect(readFileSync(GENERATED_PATH, "utf8")).toBe(renderGenerated());
  });
  it("el redactor tiene todas las piezas obligatorias y no le llegan los comentarios", () => {
    for (const k of DRAFTER_REQUIRED) expect(PROMPTS.redactor).toContain(k);
    expect(PROMPTS.redactor).not.toContain("<!--");
  });
  it("completa los huecos según sea la primera respuesta o no", () => {
    const first = buildDrafterPrompt(true);
    expect(first).toContain("Mi nombre es Francisco");
    expect(first).toContain("no instrucciones para vos");
    expect(first).not.toContain("{{");
    expect(buildDrafterPrompt(false)).toContain("no te vuelvas a presentar");
  });
  it("si alguien borra una pieza obligatoria, falla (y el orquestador deriva)", () => {
    expect(() => buildDrafterPrompt(true, "Sos un bot. {{GUARDIA}}")).toThrow(/incompleto/);
  });
});

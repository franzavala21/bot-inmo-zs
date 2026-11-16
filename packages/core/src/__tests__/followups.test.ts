import { describe, expect, it } from "vitest";
import { followUpStage, followUpText, followUpTemplateParams, renderFollowUpTemplate, searchPhrase } from "../leads/followups";

const H = 3600_000, NOW = Date.parse("2026-11-16T12:00:00Z");
const base = { lastAuthor: "ai", needsAttention: false, optOut: false, wantsAlerts: false };

describe("cuándo corresponde un seguimiento (código)", () => {
  it("a las 20 h, si le escribimos último", () => {
    expect(followUpStage({ ...base, lastClientAt: NOW - 21 * H }, NOW)).toBe("follow_up_1");
    expect(followUpStage({ ...base, lastClientAt: NOW - 10 * H }, NOW)).toBeNull();
    expect(followUpStage({ ...base, lastClientAt: NOW - 23.8 * H }, NOW)).toBeNull(); // sin margen para aprobarlo
  });
  it("a los 3 días, solo si aceptó avisos", () => {
    expect(followUpStage({ ...base, lastClientAt: NOW - 80 * H }, NOW)).toBeNull();
    expect(followUpStage({ ...base, wantsAlerts: true, lastClientAt: NOW - 80 * H }, NOW)).toBe("follow_up_2");
    expect(followUpStage({ ...base, wantsAlerts: true, lastClientAt: NOW - 8 * 24 * H }, NOW)).toBeNull();
  });
  it("nunca si falta contestarle, si está derivado o si pidió la baja", () => {
    expect(followUpStage({ ...base, lastAuthor: "client", lastClientAt: NOW - 21 * H }, NOW)).toBeNull();
    expect(followUpStage({ ...base, needsAttention: true, lastClientAt: NOW - 21 * H }, NOW)).toBeNull();
    expect(followUpStage({ ...base, optOut: true, lastClientAt: NOW - 21 * H }, NOW)).toBeNull();
  });
});

describe("texto del seguimiento", () => {
  const p = { property_type: { value: "casa", quote: "q" }, zones: { value: ["Salsipuedes"], quote: "q" } };
  it("retoma lo que se le mostró, con el género bien", () => {
    expect(followUpText("Ana", [{ tipo: "Casa" }, { tipo: "Casa" }], p)).toBe("Hola Ana! ¿Pudiste ver las casas que te pasé? Contame si alguna te interesa o si preferís que te busque otras opciones.");
    expect(followUpText(null, [{ tipo: "Terreno" }], p)).toContain("Hola! ¿Pudiste ver el terreno que te pasé?");
    expect(followUpText(null, [{ tipo: "Terreno" }, { tipo: "Casa" }], p)).toContain("las propiedades que te pasé");
  });
  it("si no se le mostró nada, pregunta si sigue buscando", () => {
    expect(followUpText("Ana", [], p)).toBe("Hola Ana! ¿Seguís buscando casa en Salsipuedes? Contame qué necesitás y te paso opciones.");
    expect(searchPhrase({})).toBe("una propiedad en Sierras Chicas");
  });
  it("plantilla de los 3 días", () => {
    expect(renderFollowUpTemplate(followUpTemplateParams(null, p))).toBe("Hola qué tal! Soy Francisco, de Zavala Seppey. ¿Seguís buscando casa en Salsipuedes? Si querés, te paso opciones nuevas.");
  });
});

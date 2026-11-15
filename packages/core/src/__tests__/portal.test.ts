import { describe, expect, it } from "vitest";
import { normalizeArPhone, parseContactTags, portalTemplateParams, renderPortalTemplate, toPortalLead } from "../tokko/portal";

describe("teléfonos argentinos → formato de WhatsApp", () => {
  it("formatos comunes", () => {
    expect(normalizeArPhone("5493511234567")).toBe("5493511234567");
    expect(normalizeArPhone("+54 9 351 123-4567")).toBe("5493511234567");
    expect(normalizeArPhone("543511234567")).toBe("5493511234567");      // sin el 9
    expect(normalizeArPhone("0351 15 123-4567")).toBe("5493511234567");  // con 0 y 15
    expect(normalizeArPhone("351 15 1234567")).toBe("5493511234567");
    expect(normalizeArPhone("11 15 2345 6789")).toBe("5491123456789");   // Buenos Aires
    expect(normalizeArPhone("03543 15 123456")).toBe("5493543123456");   // área de 4 dígitos
    expect(normalizeArPhone("15 1234567")).toBe("5493511234567");        // sin área: Córdoba
    expect(normalizeArPhone("1234567")).toBe("5493511234567");
  });
  it("lo que no se puede saber queda en null", () => {
    expect(normalizeArPhone("")).toBeNull();
    expect(normalizeArPhone("123")).toBeNull();
    expect(normalizeArPhone("no tengo")).toBeNull();
    expect(normalizeArPhone(null)).toBeNull();
  });
});

describe("etiquetas de Tokko", () => {
  it("origen, operación, tipo y zonas", () => {
    const r = parseContactTags([
      { name: "Zonaprop", group_name: "Origen de contacto" }, { name: "Web", group_name: null }, { name: "Venta", group_name: null },
      { name: "Casas", group_name: null }, { name: "Salsipuedes", group_name: null }, { name: "Argentina | Cordoba | Colon | Río Ceballos", group_name: null },
      { name: "Consulta", group_name: null },
    ]);
    expect(r).toMatchObject({ origin: "Zonaprop", operation: "sale", property_type: "casa", zones: ["Salsipuedes", "Río Ceballos"] });
  });
  it("sin grupo de origen: toma Web o WhatsApp; terrenos y alquiler", () => {
    const r = parseContactTags([{ name: "Contacto por Whatsapp" }, { name: "Alquiler" }, { name: "Terrenos y Lotes - Propiedades Individuales" }]);
    expect(r).toMatchObject({ origin: "Contacto por Whatsapp", operation: "rent", property_type: "terreno", zones: [] });
  });
  it("el contacto queda con teléfono normalizado y crudo", () => {
    const l = toPortalLead({ id: 1, name: " Ana Pérez ", cellphone: "0351 15 123-4567", created_at: "2026-11-13T10:00:00", tags: [] });
    expect(l).toMatchObject({ tokko_contact_id: 1, name: "Ana Pérez", phone: "5493511234567", phone_raw: "0351 15 123-4567" });
  });
});

describe("plantilla de consulta de portal", () => {
  it("nombre de pila, portal y zona; con reemplazos si faltan", () => {
    expect(renderPortalTemplate(portalTemplateParams({ name: "Ana Pérez", origin: "Zonaprop", zones: ["Salsipuedes"] })))
      .toBe("Hola Ana! Soy Francisco, de Zavala Seppey. Vimos tu consulta en Zonaprop por una propiedad en Salsipuedes. ¿Seguís buscando? Contame qué necesitás y te paso opciones.");
    expect(portalTemplateParams({ name: "Inmobiliaria Sur", origin: "Web", zones: [] })).toEqual(["qué tal", "nuestra web", "Sierras Chicas"]);
  });
});

import { seedProfile } from "../leads/seed";
describe("ficha inicial desde el portal", () => {
  it("operación, tipo, zona y nombre, con la fuente como frase", () => {
    const p = seedProfile({ name: "Ana Pérez", origin: "Zonaprop", operation: "sale", property_type: "casa", zones: ["Colón"] }, "T");
    expect(p).toMatchObject({
      operation: { value: "sale", quote: "Consulta en Zonaprop (Tokko)" }, property_type: { value: "casa" }, zones: { value: ["Colón"] },
      name: { value: "Ana Pérez", quote: "Nombre en Tokko (Zonaprop)" },
    });
  });
  it("sin datos no inventa nada; un nombre raro no se usa", () => {
    expect(seedProfile({ name: "Inmobiliaria Sur", origin: null, operation: null, property_type: null, zones: [] }, "T")).toEqual({});
  });
});

import { describe, it, expect } from "vitest";
import { mapTokkoProperty } from "../tokko/mapper";

const base = {
  id: 1, reference_code: "VDE123", publication_title: "Depto 2 amb", type: { name: "Departamento" },
  location: { name: "Palermo" }, address: "Gorriti 4500", real_address: "Gorriti 4512 3B",
  operations: [{ operation_type: "Sale", prices: [{ currency: "USD", price: 120000 }] }],
  room_amount: 2, total_surface: "55.5", tags: [{ name: "Balcón" }, { name: "Acepta mascotas" }],
};

describe("mapTokkoProperty", () => {
  it("mapea venta, precio y superficie", () => {
    const r = mapTokkoProperty(base);
    expect(r.operation).toBe("sale");
    expect(r.price).toBe(120000);
    expect(r.currency).toBe("USD");
    expect(r.surface_total).toBe(55.5);
    expect(r.zone).toBe("Palermo");
    expect(r.pets_allowed).toBe(true);
  });
  it("nunca usa real_address", () => {
    expect(mapTokkoProperty(base).address).toBe("Gorriti 4500");
  });
  it("detecta 'no acepta mascotas'", () => {
    expect(mapTokkoProperty({ ...base, tags: [{ name: "No acepta mascotas" }] }).pets_allowed).toBe(false);
  });
  it("marca ocupada por tag", () => {
    expect(mapTokkoProperty({ ...base, tags: [{ name: "Ocupado con inquilino" }] }).is_occupied).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { isAvailable, mapTokkoProperty } from "../tokko/mapper";

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
  it("solo status 2 cuenta como disponible", () => {
    expect(isAvailable({ ...base, status: 2 })).toBe(true);
    expect(isAvailable({ ...base, status: 3 })).toBe(false);
    expect(isAvailable({ ...base })).toBe(false);
  });
  it("en terrenos usa surface (lote) cuando total_surface viene en 0", () => {
    expect(mapTokkoProperty({ ...base, surface: "700.00", total_surface: "0.00" }).surface_total).toBe(700);
  });
  it("limpia espacios de la descripción", () => {
    expect(mapTokkoProperty({ ...base, description: "   Hola\n   " }).description).toBe("Hola");
  });
});

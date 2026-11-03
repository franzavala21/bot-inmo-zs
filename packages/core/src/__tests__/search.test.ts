import { describe, it, expect } from "vitest";
import { normalize, parseRooms, PUBLIC_COLUMNS } from "../retrieval/search";

describe("búsqueda", () => {
  it("entiende sinónimos", () => {
    expect(normalize("Busco DEPTO en Belgrano")).toBe("busco departamento en belgrano");
    expect(normalize("un mono")).toBe("un monoambiente");
  });
  it("parsea ambientes", () => {
    expect(parseRooms("busco un dos ambientes")).toBe(2);
    expect(parseRooms("3 amb")).toBe(3);
    expect(parseRooms("monoambiente")).toBe(1);
  });
  it("la búsqueda nunca pide dirección ni datos internos", () => {
    for (const c of ["address", "internal_notes", "owner_data", "raw"]) expect(PUBLIC_COLUMNS).not.toMatch(new RegExp(`\\b${c}\\b`));
  });
});

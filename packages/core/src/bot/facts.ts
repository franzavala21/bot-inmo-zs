import type { PropertyFact } from "./types";

/** Fila de properties_public con las columnas de PUBLIC_COLUMNS. */
export interface PublicRow {
  id: string; reference_code: string | null; tokko_id: number; operation: "sale" | "rent" | null;
  property_type: string | null; title: string | null; description: string | null;
  price: number | null; currency: string | null; expenses: number | null; zone: string | null;
  rooms: number | null; bedrooms: number | null; bathrooms: number | null;
  surface_total: number | null; surface_covered: number | null; pets_allowed: boolean | null;
  amenities: string[] | null; public_url: string | null;
}

/** 59000 → "59.000" (formato argentino). */
export const fmtNumber = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n);
const money = (n: number | null, cur: string | null) => (n != null && n > 0 ? `${cur ?? ""} ${fmtNumber(n)}`.trim() : null);
const pos = (n: number | null) => (n != null && n > 0 ? n : null);

export function toFact(r: PublicRow): PropertyFact {
  return {
    codigo: r.reference_code ?? String(r.tokko_id),
    operacion: r.operation === "sale" ? "venta" : r.operation === "rent" ? "alquiler" : null,
    tipo: r.property_type,
    titulo: r.title,
    zona: r.zone,
    precio: money(r.price, r.currency),
    // Tokko no informa la moneda de las expensas: va solo el número, con la aclaración.
    expensas: pos(r.expenses) ? `${fmtNumber(r.expenses!)} (moneda sin dato)` : null,
    ambientes: pos(r.rooms),
    dormitorios: pos(r.bedrooms),
    banos: pos(r.bathrooms),
    superficie_total_m2: pos(r.surface_total),
    superficie_cubierta_m2: pos(r.surface_covered),
    mascotas: r.pets_allowed == null ? "sin dato" : r.pets_allowed ? "sí" : "no",
    caracteristicas: (r.amenities ?? []).slice(0, 25),
    link: r.public_url,
    descripcion: r.description ? r.description.slice(0, 900) : null,
  };
}

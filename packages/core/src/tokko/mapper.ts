import type { TokkoProperty } from "./client";

export type Operation = "sale" | "rent";

export interface PropertyRow {
  tokko_id: number;
  reference_code: string | null;
  operation: Operation | null;
  property_type: string | null;
  title: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  expenses: number | null;
  zone: string | null;
  address: string | null;
  is_occupied: boolean;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  surface_total: number | null;
  surface_covered: number | null;
  pets_allowed: boolean | null;
  amenities: string[];
  photo_url: string | null;
  public_url: string | null;
  status: "active";
  raw: TokkoProperty;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Tokko: status 2 = disponible. Todo lo demás (reservada, no disponible) no se publica al bot. */
export const isAvailable = (p: TokkoProperty): boolean => p.status === 2;

const OP_MAP: Record<string, Operation> = { sale: "sale", venta: "sale", rent: "rent", alquiler: "rent" };

/**
 * Una propiedad de Tokko puede tener varias operaciones (venta y alquiler).
 * Devolvemos una fila por operación preferida: si tiene la operación pedida, esa; si no, la primera.
 */
export function mapTokkoProperty(p: TokkoProperty): PropertyRow {
  const ops = (p.operations ?? []).map((o) => ({
    op: OP_MAP[(o.operation_type ?? "").toLowerCase()] ?? null,
    price: o.prices?.[0],
  }));
  const main = ops.find((o) => o.op === "sale") ?? ops[0];

  const tagNames = (p.tags ?? []).map((t) => (t.name ?? "").trim()).filter(Boolean);
  const lowerTags = tagNames.map((t) => t.toLowerCase());
  const petsTag = lowerTags.find((t) => t.includes("mascota"));

  const cover = p.photos?.find((ph) => ph.is_front_cover) ?? p.photos?.[0];

  return {
    tokko_id: p.id,
    reference_code: p.reference_code ?? null,
    operation: main?.op ?? null,
    property_type: p.type?.name ?? null,
    title: p.publication_title ?? null,
    description: p.description?.trim() || null,
    price: num(main?.price?.price),
    currency: main?.price?.currency ?? null,
    expenses: num(p.expenses),
    zone: p.location?.name ?? p.location?.short_location ?? null,
    // Usamos la dirección que Tokko ya publica, nunca real_address.
    address: p.fake_address || p.address || null,
    // Las ocupadas se pasan a "no disponible" en Tokko y quedan afuera por isAvailable().
    is_occupied: false,
    rooms: num(p.room_amount),
    bedrooms: num(p.suite_amount),
    bathrooms: num(p.bathroom_amount),
    // En terrenos Tokko carga los m² en `surface` (lote) y deja total_surface en 0.
    surface_total: num(p.surface) ?? num(p.total_surface),
    surface_covered: num(p.roofed_surface),
    pets_allowed: petsTag ? !petsTag.includes("no") : null,
    amenities: tagNames,
    photo_url: cover?.image ?? null,
    public_url: p.public_url ?? null,
    status: "active",
    raw: p,
  };
}

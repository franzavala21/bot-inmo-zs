// Búsqueda de propiedades por CÓDIGO (no por el modelo): el modelo podría decidir no buscar.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SearchFilters {
  text?: string;
  operation?: "sale" | "rent";
  propertyType?: string;
  zone?: string;
  roomsMin?: number;
  bedroomsMin?: number;
  priceMax?: number;
  currency?: string;
  pets?: boolean;
  limit?: number;
}

const SYNONYMS: [RegExp, string][] = [
  [/\b(depto|dpto|dto|deptos|departamentos)\b/g, "departamento"],
  [/\b(monoamb|mono|monoambientes)\b/g, "monoambiente"],
  [/\b(casas|chalet|chalets)\b/g, "casa"],
  [/\b(ph|p\.h\.)\b/g, "ph"],
  [/\b(locales|local comercial)\b/g, "local"],
  [/\b(terrenos|lote|lotes)\b/g, "terreno"],
  [/\b(oficinas)\b/g, "oficina"],
  [/\b(cochera|cocheras|garage|garaje)\b/g, "cochera"],
];

export function normalize(s: string): string {
  let out = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [re, rep] of SYNONYMS) out = out.replace(re, rep);
  return out.replace(/\s+/g, " ").trim();
}

/** "2 ambientes", "dos ambientes", "2 amb" → 2 */
export function parseRooms(s: string): number | undefined {
  const words: Record<string, number> = { un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
  const m = normalize(s).match(/\b(\d|un|uno|dos|tres|cuatro|cinco)\s*(amb|ambientes?)\b/);
  if (!m) return normalize(s).includes("monoambiente") ? 1 : undefined;
  return words[m[1]] ?? Number(m[1]);
}

export const PUBLIC_COLUMNS =
  "id, tokko_id, reference_code, operation, property_type, title, description, price, currency, expenses, zone, rooms, bedrooms, bathrooms, surface_total, surface_covered, pets_allowed, amenities, public_url, web_url";

export async function searchProperties(db: SupabaseClient, f: SearchFilters) {
  // Solo la vista publicable. Nunca la tabla `properties`.
  let q = db.from("properties_public").select(PUBLIC_COLUMNS).limit(f.limit ?? 4);
  if (f.operation) q = q.eq("operation", f.operation);
  if (f.propertyType) q = q.ilike("property_type", `%${f.propertyType}%`);
  // En la base las zonas están sin acentos ("Rio Ceballos"): se compara sin acentos.
  if (f.zone) q = q.ilike("zone", `%${f.zone.normalize("NFD").replace(/[\u0300-\u036f]/g, "")}%`);
  if (f.roomsMin) q = q.gte("rooms", f.roomsMin);
  if (f.bedroomsMin) q = q.gte("bedrooms", f.bedroomsMin);
  if (f.priceMax) q = q.lte("price", f.priceMax);
  if (f.currency) q = q.eq("currency", f.currency);
  if (f.pets === true) q = q.or("pets_allowed.is.null,pets_allowed.eq.true");
  if (f.text) {
    const terms = normalize(f.text).split(" ").filter((t) => t.length > 2).slice(0, 5);
    for (const t of terms) q = q.ilike("search_text", `%${t}%`);
  }
  const { data, error } = await q.order("price", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

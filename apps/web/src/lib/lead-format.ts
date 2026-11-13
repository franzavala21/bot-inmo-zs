import { SERVICE_WINDOW_MS, type Evidence, type LeadField, type Profile } from "@inmo/core";

export const FIELD_TITLE: Record<LeadField, string> = {
  operation: "Operación", zones: "Zona", property_type: "Tipo", budget_max: "Presupuesto", budget_currency: "Moneda",
  rooms_min: "Dormitorios", pets: "Mascotas", timeframe: "Plazo", financing: "Pago", name: "Nombre", wants_visit: "Visita", purpose: "Para qué",
};
const FINANCING: Record<string, string> = { cash: "Contado", needs_credit: "Necesita crédito", needs_to_sell: "Tiene que vender antes", other: "Otra forma" };

/** Valor legible de un dato de la ficha. */
export function showValue(field: LeadField, v: unknown, p?: Profile): string {
  if (v === null || v === undefined) return "—";
  switch (field) {
    case "operation": return v === "rent" ? "Alquiler" : "Compra";
    case "zones": return (v as string[]).join(", ");
    case "budget_max": {
      const cur = (p?.budget_currency?.value as string | undefined) ?? "";
      return `${cur ? cur + " " : ""}${Number(v).toLocaleString("es-AR")}`;
    }
    case "timeframe": return Number(v) === 0 ? "Inmediato" : `En ${v} ${Number(v) === 1 ? "mes" : "meses"}`;
    case "financing": return FINANCING[v as string] ?? String(v);
    case "purpose": return ({ vivienda: "Para vivir", fin_de_semana: "Fin de semana", inversion: "Inversión" } as Record<string, string>)[v as string] ?? String(v);
    case "pets": case "wants_visit": return v ? "Sí" : "No";
    default: return String(v);
  }
}

/** Los datos que se muestran en la lista (la moneda va dentro del presupuesto). */
export const SHOWN_FIELDS: LeadField[] = ["name", "operation", "property_type", "zones", "budget_max", "rooms_min", "timeframe", "financing", "purpose", "pets"];

export function evidence(p: Profile, f: LeadField): Evidence | null { return p[f] ?? null; }

/** Hasta cuándo se le puede escribir texto libre (24 h desde su último mensaje). */
export function windowInfo(lastClientAt: string | null): { open: boolean; label: string } {
  if (!lastClientAt) return { open: false, label: "Sin mensajes del cliente" };
  const until = new Date(new Date(lastClientAt).getTime() + SERVICE_WINDOW_MS);
  if (until.getTime() <= Date.now()) return { open: false, label: "Pasaron 24 h: solo con plantilla" };
  const t = until.toLocaleString("es-AR", { timeZone: "America/Argentina/Cordoba", weekday: "short", hour: "2-digit", minute: "2-digit" });
  return { open: true, label: `Se le puede escribir hasta ${t}` };
}

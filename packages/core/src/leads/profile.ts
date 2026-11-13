// Ficha guardada + lo que trae el extractor = ficha nueva y contradicciones (código puro).
// Regla: un dato que ya estaba no se pisa solo. Si el cliente dice otra cosa, queda como contradicción y decide una persona.
// Excepción: las zonas se suman (buscar en varios lugares no es contradecirse).
import { LEAD_FIELDS, normalizeQuote, type ExtractedLead } from "./extract";

export type LeadField = (typeof LEAD_FIELDS)[number];
export interface Evidence { value: unknown; quote: string; at?: string }
export type Profile = Partial<Record<LeadField, Evidence | null>>;
export interface Conflict { field: LeadField; current: Evidence; proposed: Evidence; at: string }

const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" ? normalizeQuote(a) === normalizeQuote(b) : JSON.stringify(a) === JSON.stringify(b);

export function mergeProfile(old: Profile, conflicts: Conflict[], x: ExtractedLead, at: string): { profile: Profile; conflicts: Conflict[]; changed: LeadField[] } {
  const profile: Profile = { ...old };
  const out = [...conflicts];
  const changed: LeadField[] = [];
  for (const f of LEAD_FIELDS) {
    const n = x[f];
    if (!n) continue;
    const cur = old[f];
    if (!cur) { profile[f] = { value: n.value, quote: n.quote, at }; changed.push(f); continue; }
    if (f === "zones") {
      const have = (cur.value as string[]) ?? [];
      const add = (n.value as string[]).filter((z) => !have.some((h) => same(h, z)));
      if (add.length) { profile.zones = { value: [...have, ...add], quote: `${cur.quote} / ${n.quote}`, at }; changed.push(f); }
      continue;
    }
    if (same(cur.value, n.value)) continue;
    if (out.some((c) => c.field === f && same(c.proposed.value, n.value))) continue;
    out.push({ field: f, current: cur, proposed: { value: n.value, quote: n.quote }, at });
  }
  return { profile, conflicts: out, changed };
}

/** Una persona decide una contradicción: usar lo nuevo o quedarse con lo que estaba. */
export function resolveConflict(profile: Profile, conflicts: Conflict[], index: number, accept: boolean, at: string) {
  const c = conflicts[index];
  if (!c) return { profile, conflicts };
  const p = { ...profile };
  if (accept) p[c.field] = { ...c.proposed, at };
  return { profile: p, conflicts: conflicts.filter((_, i) => i !== index) };
}

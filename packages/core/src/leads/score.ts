// Puntaje del lead: código puro, sin modelo. Con los mismos datos da siempre lo mismo y se explica regla por regla.
import type { Profile } from "./profile";

export type RuleWhen =
  | { field: string; op: "present" }
  | { field: string; op: "equals"; value: unknown }
  | { field: string; op: "lte_months"; value: number }
  | { signal: string };
export interface ScoringRule { id: string; label: string; when: RuleWhen; points: number }
export interface ScoreLine { rule_id: string; label: string; points: number }

/** Señales que se calculan al momento (no se guardan). */
export const ACTIVE_WINDOW_MS = 48 * 3600_000;

export function computeSignals(stored: string[], lastClientAt: Date | null, now: number): Set<string> {
  const s = new Set(stored);
  if (lastClientAt && now - lastClientAt.getTime() <= ACTIVE_WINDOW_MS) s.add("active_48h");
  return s;
}

function matches(w: RuleWhen, p: Profile, signals: Set<string>): boolean {
  if ("signal" in w) return signals.has(w.signal);
  const ev = p[w.field as keyof Profile];
  const v = ev?.value;
  const present = v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  switch (w.op) {
    case "present": return present;
    case "equals": return present && v === w.value;
    case "lte_months": return present && typeof v === "number" && v <= w.value;
    default: return false; // regla desconocida: no suma (mejor no puntuar que puntuar mal)
  }
}

export function scoreLead(p: Profile, signals: Set<string>, rules: ScoringRule[]): { score: number; breakdown: ScoreLine[] } {
  const breakdown = rules.filter((r) => matches(r.when, p, signals)).map((r) => ({ rule_id: r.id, label: r.label, points: r.points }));
  return { score: breakdown.reduce((a, b) => a + b.points, 0), breakdown };
}

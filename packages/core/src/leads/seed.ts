// Ficha inicial de un lead que vino de un portal: lo que ya sabemos por Tokko (operación, tipo, zona, nombre).
// Cada dato lleva como "frase" la fuente ("Consulta en Zonaprop"), para no confundirlo con algo que dijo el cliente.
// No pisa nada: si la ficha ya tiene un dato, queda el que estaba.
import type { SupabaseClient } from "@supabase/supabase-js";
import { firstName } from "../bot/name";
import { computeSignals, scoreLead } from "./score";
import { profileFromRow, publishedScoringRules } from "./run";
import type { Profile } from "./profile";

export interface PortalSeed { name: string | null; origin: string | null; operation: "sale" | "rent" | null; property_type: string | null; zones: string[] }

export function seedProfile(p: PortalSeed, at: string): Profile {
  const quote = `Consulta en ${p.origin ?? "un portal"} (Tokko)`;
  const ev = (value: unknown) => ({ value, quote, at });
  const out: Profile = {};
  if (p.operation) out.operation = ev(p.operation);
  if (p.property_type) out.property_type = ev(p.property_type);
  if (p.zones.length) out.zones = ev(p.zones);
  const n = firstName(p.name);
  if (n) out.name = { value: p.name!.trim(), quote: `Nombre en Tokko (${p.origin ?? "portal"})`, at };
  return out;
}

export async function seedLeadFromPortal(db: SupabaseClient, contactId: string, conversationId: string, p: PortalSeed): Promise<boolean> {
  const { data: row } = await db.from("lead_profiles").select("*").eq("contact_id", contactId).maybeSingle();
  const current = profileFromRow(row);
  const seed = seedProfile(p, new Date().toISOString());
  const merged: Profile = { ...current.profile };
  for (const [k, v] of Object.entries(seed)) if (!merged[k as keyof Profile]) merged[k as keyof Profile] = v;
  const rules = await publishedScoringRules(db);
  const { score, breakdown } = scoreLead(merged, computeSignals([], null, Date.now()), rules.rules);
  const { error } = await db.rpc("save_lead", {
    p_contact_id: contactId, p_conversation_id: conversationId, p_profile: merged, p_conflicts: current.conflicts,
    p_signals: [], p_score: score, p_breakdown: breakdown, p_rules_version: rules.version,
    p_last_message_at: row?.last_message_at ?? null, p_summary: `Ficha armada con la consulta de ${p.origin ?? "un portal"} (puntaje ${score})`,
  });
  if (error) { console.error("[lead] no se pudo armar la ficha del portal conv=%s: %s", conversationId, error.message); return false; }
  return true;
}

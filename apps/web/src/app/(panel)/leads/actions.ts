"use server";
import { revalidatePath } from "next/cache";
import {
  adminClient, computeSignals, profileFromRow, publishedScoringRules, resolveConflict, scoreLead, updateLead,
} from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

/** Vuelve a leer el chat y rearma la ficha (aunque no haya mensajes nuevos). */
export async function refreshLead(conversationId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireOwner())) return { ok: false, error: "No autorizado" };
  const r = await updateLead(adminClient(), conversationId, { force: true });
  revalidatePath("/leads");
  revalidatePath(`/bandeja/${conversationId}`);
  if (r === "updated" || r === "unchanged") return { ok: true };
  if (r === "no_messages") return { ok: false, error: "El cliente todavía no escribió nada" };
  if (r === "limit") return { ok: false, error: "Se llegó al tope de gasto del día" };
  return { ok: false, error: "No se pudo actualizar la ficha" };
}

/** Una persona decide una contradicción de la ficha: usar lo nuevo (accept) o quedarse con lo que estaba. */
export async function decideConflict(contactId: string, conversationId: string, index: number, accept: boolean): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const db = adminClient();
  const { data: row } = await db.from("lead_profiles").select("*").eq("contact_id", contactId).maybeSingle();
  if (!row) return { ok: false, error: "La ficha no existe" };
  const cur = profileFromRow(row);
  const c = cur.conflicts[index];
  if (!c) return { ok: false, error: "Esa contradicción ya se resolvió" };
  const next = resolveConflict(cur.profile, cur.conflicts, index, accept, new Date().toISOString());

  const [{ data: sig }, rules] = await Promise.all([
    db.from("lead_signals").select("signal").eq("contact_id", contactId),
    publishedScoringRules(db),
  ]);
  const signals = computeSignals((sig ?? []).map((s) => s.signal as string), row.last_message_at ? new Date(row.last_message_at) : null, Date.now());
  const { score, breakdown } = scoreLead(next.profile, signals, rules.rules);
  const { error } = await db.rpc("save_lead", {
    p_contact_id: contactId, p_conversation_id: conversationId, p_profile: next.profile, p_conflicts: next.conflicts,
    p_signals: [], p_score: score, p_breakdown: breakdown, p_rules_version: rules.version, p_last_message_at: row.last_message_at,
    p_summary: `Un dueño ${accept ? "aceptó el dato nuevo" : "mantuvo el dato anterior"} de "${c.field}" en la ficha (puntaje ${score})`,
  });
  if (error) return { ok: false, error: "No se pudo guardar" };
  revalidatePath("/leads");
  revalidatePath(`/bandeja/${conversationId}`);
  return { ok: true };
}

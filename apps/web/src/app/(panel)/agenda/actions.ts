"use server";
import { revalidatePath } from "next/cache";
import { adminClient } from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

const STATUSES = ["scheduled", "done", "cancelled", "no_show"] as const;
type Status = (typeof STATUSES)[number];

/** "2026-11-15T10:30" (hora de Córdoba, sin horario de verano) → instante UTC. */
function cordobaToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Agenda interna: la carga una persona. El bot nunca confirma visitas. */
export async function addVisit(form: FormData): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const contactId = String(form.get("contact_id") ?? "");
  const propertyId = String(form.get("property_id") ?? "") || null;
  const startsAt = cordobaToIso(String(form.get("starts_at") ?? ""));
  if (!contactId) return { ok: false, error: "Elegí el contacto" };
  if (!startsAt) return { ok: false, error: "Elegí día y hora" };
  const { error } = await adminClient().rpc("save_visit", {
    p_id: null, p_contact_id: contactId, p_property_id: propertyId, p_starts_at: startsAt,
    p_notes: String(form.get("notes") ?? "").slice(0, 500), p_status: "scheduled", p_user: user.id,
  });
  if (error) return { ok: false, error: "No se pudo guardar" };
  revalidatePath("/agenda");
  return { ok: true };
}

export async function setVisitStatus(visitId: string, status: Status): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  if (!STATUSES.includes(status)) return { ok: false, error: "Estado inválido" };
  const db = adminClient();
  const { data: v } = await db.from("visits").select("contact_id, property_id, starts_at, notes").eq("id", visitId).maybeSingle();
  if (!v) return { ok: false, error: "La visita no existe" };
  const { error } = await db.rpc("save_visit", {
    p_id: visitId, p_contact_id: v.contact_id, p_property_id: v.property_id, p_starts_at: v.starts_at,
    p_notes: v.notes ?? "", p_status: status, p_user: user.id,
  });
  if (error) return { ok: false, error: "No se pudo actualizar" };
  revalidatePath("/agenda");
  return { ok: true };
}

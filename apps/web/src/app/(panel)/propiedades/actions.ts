"use server";
import { revalidatePath } from "next/cache";
import { adminClient, runMatcher, syncTokko } from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

export async function syncNow() {
  if (!(await requireOwner())) throw new Error("no autorizado");
  const r = await syncTokko(adminClient(), process.env.TOKKO_API_KEY!);
  const m = await runMatcher(adminClient(), r.newPropertyIds);
  revalidatePath("/propiedades");
  revalidatePath("/avisos");
  return { fetched: r.fetched, inserted: r.inserted, deactivated: r.deactivated, drafts: m.drafts };
}

/** "Buscar interesados" para una propiedad (por ejemplo, la de un anuncio): deja avisos en borrador. */
export async function findInterested(propertyId: string): Promise<{ ok: boolean; drafts?: number; skipped?: number; error?: string }> {
  if (!(await requireOwner())) return { ok: false, error: "No autorizado" };
  const m = await runMatcher(adminClient(), [propertyId]);
  revalidatePath("/avisos");
  return { ok: true, drafts: m.drafts, skipped: m.skippedNoConsent };
}

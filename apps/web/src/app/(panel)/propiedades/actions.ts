"use server";
import { revalidatePath } from "next/cache";
import { adminClient, syncTokko } from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

export async function syncNow() {
  if (!(await requireOwner())) throw new Error("no autorizado");
  const r = await syncTokko(adminClient(), process.env.TOKKO_API_KEY!);
  revalidatePath("/propiedades");
  return { fetched: r.fetched, inserted: r.inserted, deactivated: r.deactivated };
}

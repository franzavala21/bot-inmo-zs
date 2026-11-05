"use server";
import { revalidatePath } from "next/cache";
import { adminClient } from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

const MAX_LEN = 2000;

export async function saveBusinessInfo(key: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const text = body.trim();
  if (text.length > MAX_LEN) return { ok: false, error: `Máximo ${MAX_LEN} caracteres` };
  const db = adminClient();
  const { error } = await db.from("business_info")
    .update({ body: text, updated_by: user.id, updated_at: new Date().toISOString() }).eq("key", key);
  if (error) return { ok: false, error: "No se pudo guardar" };
  await db.from("audit_log").insert({ event: "business_info_updated", summary: `Un dueño editó la info del negocio: ${key}`,
    details: { key, by: user.id, chars: text.length } });
  revalidatePath("/negocio");
  return { ok: true };
}

"use server";
import { revalidatePath } from "next/cache";
import { adminClient } from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

const MAX_LEN = 4000;

/** Respuesta de un dueño. human_reply encola, anota en audit_log y pasa el chat a humano, todo en una transacción. */
export async function sendReply(conversationId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireOwner();
  if (!user) return { ok: false, error: "No autorizado" };
  const text = body.trim();
  if (!text) return { ok: false, error: "El mensaje está vacío" };
  if (text.length > MAX_LEN) return { ok: false, error: `Máximo ${MAX_LEN} caracteres` };
  const { error } = await adminClient().rpc("human_reply", { p_conversation_id: conversationId, p_body: text, p_user: user.id });
  if (error) {
    console.error("[bandeja] no se pudo encolar respuesta conv=%s", conversationId, error.code);
    return { ok: false, error: "No se pudo enviar. Probá de nuevo." };
  }
  revalidatePath(`/bandeja/${conversationId}`);
  revalidatePath("/bandeja");
  return { ok: true };
}

export async function setMode(conversationId: string, mode: "ai" | "human") {
  const user = await requireOwner();
  if (!user) throw new Error("No autorizado");
  const { error } = await adminClient().rpc("set_conversation_mode", { p_conversation_id: conversationId, p_mode: mode, p_user: user.id });
  if (error) throw new Error("No se pudo cambiar el modo");
  revalidatePath(`/bandeja/${conversationId}`);
  revalidatePath("/bandeja");
}

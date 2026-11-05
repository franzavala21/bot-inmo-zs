"use server";
import { revalidatePath } from "next/cache";
import { adminClient } from "@inmo/core";
import { requireOwner } from "@/lib/supabase/server";

/** Prender/apagar el bot de un canal. Queda anotado en audit_log en la misma transacción. */
export async function setBotEnabled(channelId: string, enabled: boolean) {
  const user = await requireOwner();
  if (!user) throw new Error("No autorizado");
  const { error } = await adminClient().rpc("set_bot_enabled", { p_channel_id: channelId, p_enabled: enabled, p_user: user.id });
  if (error) throw new Error("No se pudo cambiar el estado del bot");
  revalidatePath("/conexion");
}

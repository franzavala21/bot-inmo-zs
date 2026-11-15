"use server";
import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";

export async function signOut() {
  const sb = await serverClient();
  await sb.auth.signOut();
  redirect("/login");
}

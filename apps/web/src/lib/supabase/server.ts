import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function serverClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}

export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** Devuelve el usuario si es dueño; si no, null. Usar en cada server action que escriba. */
export async function requireOwner() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email || !allowedEmails().includes(user.email.toLowerCase())) return null;
  return user;
}

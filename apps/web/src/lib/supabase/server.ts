import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

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

/**
 * Usuario dueño verificado con Supabase (getUser valida el token en el servidor de Auth), o null.
 * cache(): una sola verificación por pedido aunque la llamen el layout, la página y los contadores.
 */
const getOwner = cache(async () => {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user?.email || !allowedEmails().includes(user.email.toLowerCase())) return null;
  return user;
});

/** Devuelve el usuario si es dueño; si no, null. Usar en cada server action que escriba. */
export async function requireOwner() {
  return getOwner();
}

/**
 * Para las páginas del panel: verifica que sea dueño (si no, al login) y devuelve el cliente con su sesión.
 * La verificación real vive acá y no en el middleware: la función corre al lado de la base (rápido),
 * mientras que el middleware corre en el borde y cada consulta a Auth cruzaba el continente (~600 ms).
 */
export async function ownerClient() {
  if (!(await getOwner())) redirect("/login");
  return serverClient();
}

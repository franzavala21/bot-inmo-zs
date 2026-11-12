import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Rutas públicas declaradas. Todo lo demás exige sesión de un dueño.
const PUBLIC = ["/login", "/auth/callback", "/api/inbound", "/api/cron", "/api/whatsapp/meta", "/api/health"];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC.some((p) => path === p || path.startsWith(p + "/"))) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  const allowed = (process.env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  if (!user?.email || !allowed.includes(user.email.toLowerCase())) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

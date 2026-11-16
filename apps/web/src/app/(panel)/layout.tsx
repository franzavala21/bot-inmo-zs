import { Suspense } from "react";
import { Nav, type NavGroup } from "@/components/nav";
import { Icon } from "@/components/icons";
import { requireOwner, serverClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

// Los contadores y el estado se cargan aparte (Suspense): la página no espera por ellos.
async function Count({ table, filter, tone = "zinc" }: { table: "conversations" | "outbound_drafts" | "portal_leads"; filter: [string, string | boolean]; tone?: "red" | "zinc" }) {
  if (!(await requireOwner())) return null;
  const sb = await serverClient();
  const { count } = await sb.from(table).select("id", { count: "exact", head: true }).eq(filter[0], filter[1]);
  if (!count) return null;
  return (
    <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 ${tone === "red" ? "bg-red-500 text-white" : "bg-zinc-200 text-zinc-700"}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
const badge = (props: Parameters<typeof Count>[0]) => <Suspense fallback={null}><Count {...props} /></Suspense>;

async function Footer() {
  const user = await requireOwner();
  const sb = await serverClient();
  const { data: ch } = await sb.from("channels").select("bot_enabled, transport").eq("slug", "ventas").maybeSingle();
  return (
    <div className="space-y-2">
      {ch && (
        <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2 py-1.5 text-xs text-zinc-600">
          <span className={`h-2 w-2 rounded-full ${ch.bot_enabled ? "bg-emerald-500" : "bg-zinc-300"}`} />
          Bot {ch.bot_enabled ? "prendido" : "apagado"}
          <span className="ml-auto text-zinc-400">{ch.transport === "meta" ? "WhatsApp oficial" : "WhatsApp"}</span>
        </div>
      )}
      <div className="flex items-center gap-2 px-1">
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{user?.email}</span>
        <form action={signOut}>
          <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100" title="Salir">
            <Icon name="logout" className="h-4 w-4" /> Salir
          </button>
        </form>
      </div>
    </div>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const groups: NavGroup[] = [
    { title: "General", items: [{ href: "/inicio", label: "Inicio", icon: "dashboard" }] },
    { title: "Clientes", items: [
      { href: "/bandeja", label: "Bandeja", icon: "inbox", badge: badge({ table: "conversations", filter: ["needs_attention", true], tone: "red" }) },
      { href: "/leads", label: "A quién llamar", icon: "phone" },
      { href: "/consultas", label: "Consultas de portales", icon: "globe", badge: badge({ table: "portal_leads", filter: ["status", "new"] }) },
      { href: "/avisos", label: "Avisos", icon: "bell", badge: badge({ table: "outbound_drafts", filter: ["status", "pending"] }) },
      { href: "/agenda", label: "Agenda", icon: "calendar" },
    ] },
    { title: "Inmobiliaria", items: [
      { href: "/propiedades", label: "Propiedades", icon: "home" },
      { href: "/negocio", label: "Info del negocio", icon: "info" },
    ] },
    { title: "Sistema", items: [{ href: "/conexion", label: "Conexión", icon: "link" }] },
  ];
  return (
    <div className="min-h-screen md:flex">
      <Nav groups={groups} footer={<Suspense fallback={<div className="h-14" />}><Footer /></Suspense>} />
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">{children}</main>
    </div>
  );
}

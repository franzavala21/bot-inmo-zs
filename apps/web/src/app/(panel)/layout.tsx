import Link from "next/link";

const NAV = [
  { href: "/bandeja", label: "Bandeja" },
  { href: "/leads", label: "A quién llamar", soon: true },
  { href: "/propiedades", label: "Propiedades" },
  { href: "/avisos", label: "Avisos", soon: true },
  { href: "/agenda", label: "Agenda", soon: true },
  { href: "/reglas", label: "Reglas", soon: true },
  { href: "/conexion", label: "Conexión" },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen md:flex">
      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white p-2 md:w-52 md:flex-col md:border-b-0 md:border-r">
        <span className="hidden px-3 py-2 text-sm font-semibold md:block">Inmo CRM</span>
        {NAV.map((n) =>
          n.soon ? (
            <span key={n.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-zinc-400">{n.label}</span>
          ) : (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-zinc-100">{n.label}</Link>
          ),
        )}
      </nav>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}

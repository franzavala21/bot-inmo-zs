"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; icon: IconName; badge?: ReactNode };
export type NavGroup = { title: string; items: NavItem[] };

/** Barra lateral (escritorio) y menú desplegable (celular). Los contadores llegan ya armados desde el servidor. */
export function Nav({ groups, footer }: { groups: NavGroup[]; footer: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const active = (href: string) => path === href || path.startsWith(href + "/");

  const links = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{g.title}</div>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.href}>
                <Link href={it.href}
                  className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors ${active(it.href)
                    ? "bg-emerald-50 font-medium text-emerald-900" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}>
                  <Icon name={it.icon} className={`h-[18px] w-[18px] shrink-0 ${active(it.href) ? "text-emerald-700" : "text-zinc-400"}`} />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.badge}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  const brand = (
    <Link href="/bandeja" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-700 text-sm font-bold text-white">ZS</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-zinc-900">Zavala Seppey</span>
        <span className="block text-[11px] text-zinc-500">CRM y bot de WhatsApp</span>
      </span>
    </Link>
  );

  return (
    <>
      {/* Celular: barra superior con menú */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/90 px-4 py-2.5 backdrop-blur md:hidden">
        {brand}
        <button onClick={() => setOpen(true)} aria-label="Abrir menú" className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100">
          <Icon name="menu" />
        </button>
      </header>
      {open && <div className="fixed inset-0 z-40 bg-zinc-900/30 md:hidden" onClick={() => setOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-200 bg-white transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-4">
          {brand}
          <button onClick={() => setOpen(false)} aria-label="Cerrar menú" className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 md:hidden">
            <Icon name="close" />
          </button>
        </div>
        {links}
        <div className="border-t border-zinc-100 p-3">{footer}</div>
      </aside>
    </>
  );
}

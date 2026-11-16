import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

// Piezas visuales comunes del panel.

const AVATAR_TONES = ["bg-emerald-100 text-emerald-800", "bg-sky-100 text-sky-800", "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800"];

/** Círculo con iniciales; el color sale del nombre (siempre el mismo para la misma persona). */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const clean = name.replace(/[^\p{L}\s]/gu, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dims = size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-11 w-11 text-base" : "h-10 w-10 text-sm";
  return <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${dims} ${AVATAR_TONES[h % AVATAR_TONES.length]}`}>{parts.length ? initials : "#"}</span>;
}

const PILL: Record<string, string> = {
  red: "bg-red-50 text-red-700 ring-red-200", amber: "bg-amber-50 text-amber-800 ring-amber-200", green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200", zinc: "bg-zinc-100 text-zinc-600 ring-zinc-200", violet: "bg-violet-50 text-violet-800 ring-violet-200",
};
export function Pill({ tone = "zinc", children }: { tone?: keyof typeof PILL; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PILL[tone]}`}>{children}</span>;
}

/** Número grande con título, para el Inicio. */
export function StatCard({ href, label, value, hint, icon, tone = "zinc" }: {
  href: string; label: string; value: number; hint?: string; icon: IconName; tone?: "red" | "amber" | "green" | "zinc";
}) {
  const accent = value === 0 ? "text-zinc-400" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-600" : tone === "green" ? "text-emerald-700" : "text-zinc-900";
  return (
    <Link href={href} className="group rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow">
      <div className="flex items-center justify-between text-sm text-zinc-500">
        {label}
        <Icon name={icon} className="h-[18px] w-[18px] text-zinc-300 group-hover:text-emerald-600" />
      </div>
      <div className={`mt-2 text-3xl font-semibold tabular-nums ${accent}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </Link>
  );
}

/** Bloque con título y link "Ver todo". */
export function Panel({ title, href, children, empty }: { title: string; href?: string; children: ReactNode; empty?: string | false }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-800">{title}</h2>
        {href && <Link href={href} className="text-xs font-medium text-emerald-700 hover:underline">Ver todo</Link>}
      </header>
      {empty ? <p className="px-4 py-6 text-center text-sm text-zinc-400">{empty}</p> : children}
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
      <p className="font-medium text-zinc-700">{title}</p>
      {children && <p className="mt-1 text-sm text-zinc-500">{children}</p>}
    </div>
  );
}

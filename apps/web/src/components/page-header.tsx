import type { ReactNode } from "react";

/** Encabezado común de las pantallas del panel. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 md:text-2xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

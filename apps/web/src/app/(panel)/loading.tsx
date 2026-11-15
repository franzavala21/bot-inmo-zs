// Se muestra al instante al cambiar de pantalla, mientras el servidor arma la página.
export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse space-y-4" aria-busy="true" aria-label="Cargando">
      <div className="h-7 w-48 rounded-md bg-zinc-200" />
      <div className="h-4 w-80 max-w-full rounded bg-zinc-100" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-xl border border-zinc-200 bg-white" />)}
      </div>
    </div>
  );
}

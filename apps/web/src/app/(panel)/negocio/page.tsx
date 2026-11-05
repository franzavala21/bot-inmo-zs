import { serverClient } from "@/lib/supabase/server";
import { InfoForm } from "./info-form";

export default async function Negocio() {
  const sb = await serverClient();
  const { data } = await sb.from("business_info").select("key, title, body").order("sort");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Info del negocio</h1>
      <p className="text-sm text-zinc-600">
        Además de las fichas de Tokko, esto es <b>lo único</b> que el bot puede afirmar sobre la inmobiliaria.
        Escribilo como se lo dirías a un cliente. Si un tema queda vacío y alguien pregunta, el bot lo deriva a ustedes.
      </p>
      {(data ?? []).map((b) => <InfoForm key={b.key} infoKey={b.key} title={b.title} body={b.body} />)}
    </div>
  );
}

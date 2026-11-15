import { PageHeader } from "@/components/page-header";
import { ownerClient } from "@/lib/supabase/server";
import { InfoForm } from "./info-form";

export default async function Negocio() {
  const sb = await ownerClient();
  const { data } = await sb.from("business_info").select("key, title, body").order("sort");
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Info del negocio" description={<>Además de las fichas de Tokko, esto es <b>lo único</b> que el bot puede afirmar sobre la inmobiliaria.
        Escribilo como se lo dirías a un cliente. Si un tema queda vacío y alguien pregunta, el bot lo deriva a ustedes.</>} />
      {(data ?? []).map((b) => <InfoForm key={b.key} infoKey={b.key} title={b.title} body={b.body} />)}
    </div>
  );
}

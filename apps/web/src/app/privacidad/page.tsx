import type { Metadata } from "next";

// Página pública (la pide Meta para publicar la app de WhatsApp). Sin datos de la base: texto fijo.
export const metadata: Metadata = {
  title: "Política de privacidad · Inmobiliaria Zavala Seppey",
  description: "Cómo tratamos los datos de quienes nos escriben por WhatsApp.",
};

const UPDATED = "14 de noviembre de 2026";
const WEB = "https://inmobiliariazavalaseppey.com.ar/";

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-2 text-[15px] leading-relaxed text-zinc-700">{children}</div>
    </section>
  );
}

export default function Privacidad() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Política de privacidad</h1>
        <p className="text-sm text-zinc-500">Inmobiliaria Zavala Seppey · Córdoba, Argentina · Última actualización: {UPDATED}</p>
      </header>

      <p className="text-[15px] leading-relaxed text-zinc-700">
        Esta política explica qué datos tratamos cuando nos escribís por WhatsApp o nos dejás una consulta en un portal inmobiliario, para qué los usamos y cómo podés
        pedir que los corrijamos o los borremos. Aplica a nuestro canal de WhatsApp y a la herramienta interna con la que
        lo atendemos.
      </p>

      <Section title="Quién es responsable">
        <p>
          Inmobiliaria Zavala Seppey, con actividad en la provincia de Córdoba, Argentina, es responsable de los datos
          descriptos acá. Sitio web: <a className="text-blue-700 underline" href={WEB}>{WEB}</a>.
        </p>
      </Section>

      <Section title="Qué datos tratamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Tu número de WhatsApp y el nombre de perfil que tengas configurado.</li>
          <li>Los mensajes que nos mandás: texto, audios, imágenes y otros archivos.</li>
          <li>Lo que nos cuentes sobre tu búsqueda: tipo de propiedad, zona, presupuesto y preferencias.</li>
          <li>Las respuestas que te enviamos y el registro interno de cada respuesta (qué se respondió y cuándo).</li>
          <li>
            Si nos dejaste una consulta en un portal (por ejemplo Zonaprop o Mercado Libre) o en nuestra web: tu nombre, teléfono,
            email y lo que consultaste, tal como nos llegan a nuestro sistema de gestión.
          </li>
        </ul>
        <p>No te pedimos datos sensibles ni datos bancarios por WhatsApp.</p>
      </Section>

      <Section title="Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Responder tus consultas y mostrarte propiedades disponibles que coincidan con lo que buscás.</li>
          <li>Pasar tu consulta a una persona del equipo cuando hace falta (por ejemplo, para coordinar una visita).</li>
          <li>Responderte por WhatsApp una consulta que nos dejaste en un portal o en la web. Ese primer mensaje lo aprueba una persona del equipo.</li>
          <li>Hacer el seguimiento comercial de tu consulta.</li>
        </ul>
        <p>No vendemos ni cedemos tus datos a terceros para publicidad.</p>
      </Section>

      <Section title="Asistente automático">
        <p>
          Algunas respuestas las escribe un asistente automático que usa inteligencia artificial y solo informa datos de
          las propiedades publicadas y de la inmobiliaria. El asistente no confirma visitas, reservas, descuentos ni
          precios negociados: eso lo hace siempre una persona del equipo. Una persona puede tomar la conversación en
          cualquier momento, y podés pedir hablar con alguien del equipo.
        </p>
      </Section>

      <Section title="Con quién se comparten">
        <p>Para funcionar usamos estos proveedores, que tratan los datos por cuenta nuestra:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Meta (WhatsApp Business):</b> transporta los mensajes.</li>
          <li><b>OpenAI:</b> procesa el texto de la conversación y transcribe los audios para que el asistente pueda responder.</li>
          <li><b>Supabase:</b> guarda las conversaciones y los archivos.</li>
          <li><b>Vercel:</b> aloja la herramienta interna.</li>
        </ul>
        <p>
          Algunos de estos proveedores procesan datos fuera de la Argentina. También podemos compartir datos si una
          autoridad competente lo exige por ley.
        </p>
      </Section>

      <Section title="Mensajes que te enviamos">
        <p>
          Respondemos a quien nos escribe. Cualquier mensaje que te mandemos sin que nos hayas escrito antes lo revisa y
          aprueba una persona del equipo. Si no querés recibir más mensajes nuestros, decínoslo por el mismo chat.
        </p>
      </Section>

      <Section title="Cuánto tiempo los guardamos">
        <p>
          Conservamos los datos el tiempo necesario para atender tu consulta y su seguimiento comercial, o hasta que
          nos pidas borrarlos, salvo que una ley nos obligue a guardarlos más tiempo.
        </p>
      </Section>

      <Section title="Cómo los cuidamos">
        <p>
          Solo los responsables de la inmobiliaria acceden a las conversaciones, con usuario propio. Las comunicaciones
          entre nuestros sistemas viajan cifradas y las claves de acceso no se comparten.
        </p>
      </Section>

      <Section id="eliminacion" title="Tus derechos y cómo pedir que borremos tus datos">
        <p>
          Podés pedir acceder a tus datos, corregirlos o eliminarlos. Para eso, escribinos por el mismo chat de WhatsApp
          o por los medios de contacto de <a className="text-blue-700 underline" href={WEB}>nuestro sitio web</a>,
          indicando qué querés hacer. Para borrar tus datos, escribí &ldquo;quiero que borren mis datos&rdquo; en el chat:
          una persona del equipo lo confirma y elimina la conversación, tus mensajes y tus archivos, y te avisa cuando está hecho.
        </p>
        <p className="text-sm text-zinc-600">
          El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los mismos en forma
          gratuita a intervalos no inferiores a seis meses, salvo que se acredite un interés legítimo al efecto conforme
          lo establecido en el artículo 14, inciso 3 de la Ley Nº 25.326. La Agencia de Acceso a la Información
          Pública, en su carácter de Órgano de Control de la Ley Nº 25.326, tiene la atribución de atender las
          denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las
          normas vigentes en materia de protección de datos personales.
        </p>
      </Section>

      <Section title="Cambios">
        <p>Si cambiamos esta política, publicamos la versión nueva en esta misma página con la fecha de actualización.</p>
      </Section>
    </main>
  );
}

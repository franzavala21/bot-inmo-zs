// Lee el email "Nueva consulta" de Tokko. Guarda solo: nombre, email, teléfono, etiquetas, mensaje, códigos de propiedad y título.
// NUNCA la dirección de la propiedad (aparece en el email, debajo del precio). El contenido es de un tercero: es dato, no instrucción.
import { normalizeArPhone } from "./portal";

export interface TokkoInquiry {
  name: string | null; email: string | null; phone: string | null; tags: string[]; message: string | null;
  propertyCodes: string[]; propertyTitle: string | null; webcontactId: number | null;
}

const ENT: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&iexcl;": "¡", "&iquest;": "¿" };
const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&[a-z]+;|&#39;/g, (e) => ENT[e] ?? e);

/** HTML → líneas de texto (cada <p>, <br>, celda o fila es un corte). */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|td|tr|h\d|li|table)>/gi, "\n")
    .replace(/<\/span>\s*<span[^>]*>/gi, " ") // etiquetas pegadas en spans: separarlas
    .replace(/<[^>]+>/g, "");
  return decode(text).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const LABELS = ["Información de contacto", "Cliente", "Correo electrónico", "Teléfono", "Etiquetas", "Mensaje", "Propiedades/Emprendimientos relacionados"];
const after = (lines: string[], label: string) => { const i = lines.indexOf(label); return i >= 0 && i + 1 < lines.length && !LABELS.includes(lines[i + 1]) ? lines[i + 1] : null; };

export function parseTokkoInquiry(html: string): TokkoInquiry {
  const lines = htmlToLines(html);
  // Mensaje: todo lo que hay entre "Mensaje" y "Propiedades/Emprendimientos relacionados".
  const mi = lines.indexOf("Mensaje"), pi = lines.indexOf("Propiedades/Emprendimientos relacionados");
  const message = mi >= 0 ? lines.slice(mi + 1, pi > mi ? pi : undefined).join("\n").slice(0, 2000) || null : null;
  // Teléfono: preferir el atributo tel: (limpio); si no, el texto.
  const tel = [...html.matchAll(/href="tel:([^"]+)"/gi)].map((m) => decodeURIComponent(m[1]));
  const phoneText = after(lines, "Teléfono");
  const phone = [...tel, ...(phoneText ? phoneText.split("/") : [])].map((p) => normalizeArPhone(p)).find(Boolean) ?? null;
  const mail = html.match(/href="mailto:([^"]+)"/i)?.[1] ?? null;
  const email = mail && !/tokkobroker\.com$/i.test(mail) ? decodeURIComponent(mail).trim().toLowerCase() : (after(lines, "Correo electrónico") ?? null);
  // Propiedades: códigos de Tokko en negrita (ZHO…, ZLA…, ZAP…), solo después de "Propiedades/Emprendimientos relacionados".
  const tail = pi >= 0 ? html.slice(html.indexOf("Propiedades/Emprendimientos relacionados")) : html;
  const propertyCodes = [...new Set([...tail.matchAll(/<b>\s*([A-Z]{3}\d{4,})\s*<\/b>/g)].map((m) => m[1]))];
  const propertyTitle = tail.match(/title="([^"]{3,120})"/)?.[1] ?? null;
  const tagsLine = html.match(/>Etiquetas<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  const tags = tagsLine ? [...tagsLine.matchAll(/<span[^>]*>([^<]+)<\/span>/gi)].map((m) => decode(m[1]).trim()).filter(Boolean) : [];
  const wc = html.match(/tokkobroker\.com\/marketing\/webcontact\/(\d+)/)?.[1];
  return { name: after(lines, "Cliente"), email: email && email.includes("@") ? email : null, phone, tags, message, propertyCodes, propertyTitle, webcontactId: wc ? Number(wc) : null };
}

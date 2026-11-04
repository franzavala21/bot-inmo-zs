/** Cómo mostrar al contacto: nombre confirmado, nombre de WhatsApp o teléfono. */
export function contactLabel(c: { name?: string | null; display_name?: string | null; phone: string }) {
  return c.name || c.display_name || phonePretty(c.phone);
}

export function phonePretty(phone: string) {
  if (phone.startsWith("lid:")) return "Sin número visible";
  return `+${phone}`;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "nunca";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

export function timeShort(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString("es-AR", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const KIND_LABEL: Record<string, string> = {
  audio: "🎤 Audio", image: "📷 Imagen", video: "🎬 Video", document: "📄 Documento",
  sticker: "Sticker", location: "📍 Ubicación", contact: "👤 Contacto", other: "Mensaje no soportado",
};

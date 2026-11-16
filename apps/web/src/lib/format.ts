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
  return new Date(iso).toLocaleDateString("es-AR", { timeZone: TZ, day: "numeric", month: "short" });
}

// El servidor (Vercel) corre en UTC: toda fecha que se muestra va en hora de Córdoba.
export const TZ = "America/Argentina/Cordoba";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

export function timeShort(iso: string) {
  const d = new Date(iso);
  const today = dayKey(new Date()) === dayKey(d);
  return d.toLocaleString("es-AR", today ? { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false } : { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Solo la hora (para las burbujas del chat). */
export function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}

export const KIND_LABEL: Record<string, string> = {
  audio: "🎤 Audio", image: "📷 Imagen", video: "🎬 Video", document: "📄 Documento",
  sticker: "Sticker", location: "📍 Ubicación", contact: "👤 Contacto", other: "Mensaje no soportado",
};

/** "lunes, 16 de noviembre" → "Lunes, 16 de noviembre" (solo la primera letra). */
export function longDay(iso: string | Date) {
  const s = new Date(iso).toLocaleDateString("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

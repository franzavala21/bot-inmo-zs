// Nombre de pila para saludar al cliente. Código, no modelo: si no hay un nombre confiable, no se usa ninguno.
// El nombre de perfil de WhatsApp es texto ajeno: se acepta solo si parece un nombre de pila (letras, una palabra).

const NOT_NAMES = new Set([
  "inmobiliaria", "inmo", "propiedades", "ventas", "venta", "alquiler", "alquileres", "casa", "casas", "info", "admin",
  "administracion", "bot", "cliente", "usuario", "user", "whatsapp", "empresa", "negocio", "servicios", "construcciones",
  "mami", "mama", "papi", "papa", "amor", "bebe", "gordo", "gorda", "flaco", "flaca", "negro", "negra", "chino", "china",
  "dr", "dra", "ing", "lic", "arq", "sr", "sra", "srta", "don", "doña", "the", "mr", "mrs",
]);

/** Primera palabra si parece un nombre de pila; si no, null. */
export function firstName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const word = raw.normalize("NFC").trim().split(/\s+/)[0] ?? "";
  if (!/^\p{L}{2,15}$/u.test(word)) return null;
  const plain = word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (NOT_NAMES.has(plain) || NOT_NAMES.has(word.toLowerCase())) return null;
  if (!/[aeiouy]/i.test(plain)) return null; // siglas o letras sueltas ("JLM", "Dpto")
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

/** En orden: nombre confirmado del contacto, el que dijo en el chat (ficha del lead), el del perfil de WhatsApp. */
export function clientFirstName(c: { name?: string | null; profileName?: string | null; displayName?: string | null }): string | null {
  return firstName(c.name) ?? firstName(c.profileName) ?? firstName(c.displayName);
}

// Configuración del worker. Las claves vienen del entorno (Railway o el .env local), nunca del código.
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const config = {
  channelSlug: process.env.CHANNEL_SLUG ?? "ventas",
  /** Carpeta de la sesión de WhatsApp. En Railway va en el volumen (ej. /data/auth). */
  authDir: process.env.AUTH_DIR ?? "./auth",
  webBaseUrl: req("WEB_BASE_URL").replace(/\/$/, ""),
  hmacSecret: req("INBOUND_HMAC_SECRET"),
  /** "baileys" en producción; "fake" para probar todo el circuito sin chip. */
  transport: (process.env.WA_TRANSPORT ?? "baileys") as "baileys" | "fake",
  port: Number(process.env.PORT ?? 8080),
  baileysLogLevel: process.env.BAILEYS_LOG_LEVEL ?? "silent",
  /** Tamaño máximo de un audio o imagen que se guarda (bytes). */
  maxMediaBytes: 16 * 1024 * 1024,
};

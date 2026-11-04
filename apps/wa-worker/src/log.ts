// Logs del worker. Privacidad: nunca teléfonos, JIDs ni texto de clientes. Solo ids internos y estados.
const ts = () => new Date().toISOString();
export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => console.log(ts(), "INFO", msg, extra ? JSON.stringify(extra) : ""),
  warn: (msg: string, extra?: Record<string, unknown>) => console.warn(ts(), "WARN", msg, extra ? JSON.stringify(extra) : ""),
  error: (msg: string, extra?: Record<string, unknown>) => console.error(ts(), "ERROR", msg, extra ? JSON.stringify(extra) : ""),
};

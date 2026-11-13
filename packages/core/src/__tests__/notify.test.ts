import { describe, expect, it } from "vitest";
import { buildHandoffEmail, notifyConfigFromEnv, notifyHandoff } from "../notify/handoff";

describe("email de derivación", () => {
  it("lleva motivo, hora límite y link; nada del cliente", () => {
    const e = buildHandoffEmail({ reason: "Quiere visitar", link: "https://x.app/bandeja/c1", deadline: new Date("2026-11-13T15:00:00Z"), isTest: false });
    expect(e.subject).toBe("Chat para atender: Quiere visitar");
    expect(e.text).toContain("Motivo: Quiere visitar");
    expect(e.text).toContain("12:00"); // 15 UTC = 12 en Córdoba
    expect(e.text).toContain("https://x.app/bandeja/c1");
  });
  it("marca las pruebas y escapa HTML", () => {
    const e = buildHandoffEmail({ reason: "<b>x</b>", link: "https://x", deadline: null, isTest: true });
    expect(e.subject.startsWith("[PRUEBA]")).toBe(true);
    expect(e.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("config: necesita clave, remitente y URL", () => {
    expect(notifyConfigFromEnv({ RESEND_API_KEY: "k", NOTIFY_FROM: "a@b.com" })).toBeNull();
    expect(notifyConfigFromEnv({ RESEND_API_KEY: "k", NOTIFY_FROM: "a@b.com", VERCEL_PROJECT_PRODUCTION_URL: "x.app" })?.panelUrl).toBe("https://x.app");
  });
});

function fakeDb() {
  const inserts: Record<string, unknown>[] = [];
  const q = (data: unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["select", "eq", "order", "limit"]) c[k] = () => c;
    c.maybeSingle = async () => ({ data });
    c.then = (r: (v: unknown) => void) => r({ data });
    return c;
  };
  return {
    inserts,
    from: (t: string) => {
      if (t === "audit_log") return { insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; } };
      if (t === "allowed_users") return q([{ email: "a@x.com" }, { email: "b@x.com" }]);
      if (t === "messages") return q({ created_at: "2026-11-12T15:00:00Z" });
      return q({ attention_reason: "Quiere visitar", contact: { is_test: false } });
    },
  };
}

describe("aviso a los dueños", () => {
  it("manda a todos los dueños y lo anota", async () => {
    const db = fakeDb();
    let sent: { to: string[]; subject: string } | undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const ok = await notifyHandoff(db as never, "c1", { resendApiKey: "k", from: "bot@x.com", panelUrl: "https://x.app", fetchImpl });
    expect(ok).toBe(true);
    expect(sent?.to).toEqual(["a@x.com", "b@x.com"]);
    expect(db.inserts.at(-1)).toMatchObject({ event: "notified" });
  });
  it("si Resend falla, queda anotado y no tira", async () => {
    const db = fakeDb();
    const fetchImpl = (async () => new Response("bad", { status: 403 })) as unknown as typeof fetch;
    expect(await notifyHandoff(db as never, "c1", { resendApiKey: "k", from: "bot@x.com", panelUrl: "https://x.app", fetchImpl })).toBe(false);
    expect(db.inserts.at(-1)).toMatchObject({ event: "notify_failed" });
  });
  it("sin configurar: lo anota", async () => {
    const db = fakeDb();
    expect(await notifyHandoff(db as never, "c1", null)).toBe(false);
    expect(db.inserts.at(-1)).toMatchObject({ event: "notify_failed" });
  });
});

"use client";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await browserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback`, shouldCreateUser: false },
    });
    if (!error) return setState("sent");
    const code = (error as { code?: string }).code;
    setErrorMsg(
      code === "over_email_send_rate_limit"
        ? "Se pidieron demasiados enlaces. Esperá una hora y probá de nuevo."
        : code === "otp_disabled" || code === "signup_disabled" || error.status === 422
          ? "Ese email no está habilitado para entrar."
          : "No se pudo enviar el enlace. Probá de nuevo en un rato.",
    );
    setState("error");
  }
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-700 text-sm font-bold text-white">ZS</span>
          <div className="leading-tight">
            <h1 className="text-base font-semibold">Zavala Seppey</h1>
            <p className="text-xs text-zinc-500">CRM y bot de WhatsApp</p>
          </div>
        </div>
        <p className="text-sm text-zinc-600">Te mandamos un enlace a tu email para entrar.</p>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com" className="w-full rounded-lg border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
        <button className="w-full rounded-lg bg-emerald-700 py-2 font-medium text-white hover:bg-emerald-800">Mandame el enlace</button>
        {state === "sent" && <p className="text-sm text-green-700">Revisá tu correo y abrí el enlace.</p>}
        {state === "error" && <p className="text-sm text-red-700">{errorMsg}</p>}
      </form>
    </main>
  );
}

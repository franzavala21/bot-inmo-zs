"use client";
import { useState } from "react";
import { browserClient } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await browserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback`, shouldCreateUser: false },
    });
    setState(error ? "error" : "sent");
  }
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Entrar al CRM</h1>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com" className="w-full rounded-md border border-zinc-300 px-3 py-2" />
        <button className="w-full rounded-md bg-zinc-900 py-2 text-white">Mandame el enlace</button>
        {state === "sent" && <p className="text-sm text-green-700">Revisá tu correo y abrí el enlace.</p>}
        {state === "error" && <p className="text-sm text-red-700">No se pudo enviar. ¿El email está habilitado?</p>}
      </form>
    </main>
  );
}

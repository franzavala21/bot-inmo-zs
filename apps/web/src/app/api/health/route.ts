import { NextResponse } from "next/server";

// Chequeo público: solo dice que la web está arriba. No toca la base ni devuelve datos.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}

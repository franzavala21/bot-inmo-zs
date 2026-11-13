import { NextResponse } from "next/server";
import { adminClient, runMatcher, syncTokko } from "@inmo/core";

export const maxDuration = 300;

export async function GET(req: Request) {
  // Vercel Cron manda "Authorization: Bearer <CRON_SECRET>"
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }
  try {
    const result = await syncTokko(adminClient(), process.env.TOKKO_API_KEY!);
    // Propiedades nuevas: buscar interesados y dejar avisos en borrador (los aprueba un dueño de a uno).
    const matcher = await runMatcher(adminClient(), result.newPropertyIds);
    return NextResponse.json({ ...result, matcher });
  } catch (e) {
    console.error("[tokko-sync] error", String(e));
    return NextResponse.json({ error: "falló la sincronización" }, { status: 500 });
  }
}

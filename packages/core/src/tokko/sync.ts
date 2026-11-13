import type { SupabaseClient } from "@supabase/supabase-js";
import { TokkoClient } from "./client";
import { isAvailable, mapTokkoProperty } from "./mapper";
import { DEFAULT_SITE_URL, fetchSiteLinks } from "../web/site-links";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  deactivated: number;
  newPropertyIds: string[]; // para el matcher (fase 5)
  /** Links de la web actualizados; null si no se pudo leer el sitemap (los links anteriores quedan como estaban). */
  webLinks: number | null;
}

/** Trae todo de Tokko, hace upsert y desactiva lo que ya no viene. */
export async function syncTokko(db: SupabaseClient, tokkoKey: string): Promise<SyncResult> {
  const { data: run } = await db.from("tokko_sync_runs").insert({}).select("id").single();
  try {
    const items = await new TokkoClient(tokkoKey).listAllProperties();
    const rows = items.filter(isAvailable).map(mapTokkoProperty);

    const { data: existing, error: exErr } = await db.from("properties").select("tokko_id, status");
    if (exErr) throw exErr;
    const known = new Map((existing ?? []).map((r) => [r.tokko_id as number, r.status as string]));

    const now = new Date().toISOString();
    const newTokkoIds = rows.filter((r) => !known.has(r.tokko_id)).map((r) => r.tokko_id);

    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((r) => ({ ...r, updated_at: now }));
      const { error } = await db.from("properties").upsert(chunk, { onConflict: "tokko_id" });
      if (error) throw error;
    }

    const incoming = new Set(rows.map((r) => r.tokko_id));
    const toDeactivate = [...known.entries()]
      .filter(([id, status]) => status === "active" && !incoming.has(id))
      .map(([id]) => id);
    if (toDeactivate.length) {
      const { error } = await db.from("properties").update({ status: "inactive", updated_at: now }).in("tokko_id", toDeactivate);
      if (error) throw error;
    }

    const webLinks = await syncWebLinks(db);

    let newPropertyIds: string[] = [];
    if (newTokkoIds.length && known.size > 0) {
      // En la primera sincronización no hay "nuevas": todo es carga inicial.
      const { data } = await db.from("properties").select("id").in("tokko_id", newTokkoIds);
      newPropertyIds = (data ?? []).map((r) => r.id as string);
    }

    const result: SyncResult = {
      fetched: rows.length,
      inserted: newTokkoIds.length,
      updated: rows.length - newTokkoIds.length,
      deactivated: toDeactivate.length,
      newPropertyIds,
      webLinks,
    };
    await db.from("tokko_sync_runs").update({
      finished_at: new Date().toISOString(), fetched: result.fetched, inserted: result.inserted,
      updated: result.updated, deactivated: result.deactivated,
    }).eq("id", run?.id);
    return result;
  } catch (e) {
    await db.from("tokko_sync_runs").update({ finished_at: new Date().toISOString(), error: String(e) }).eq("id", run?.id);
    throw e;
  }
}

/** Copia en properties.web_url el link de cada propiedad en la web. Si el sitemap no responde, no toca nada. */
export async function syncWebLinks(db: SupabaseClient, siteUrl = process.env.SITE_URL ?? DEFAULT_SITE_URL): Promise<number | null> {
  let links: Map<number, string>;
  try { links = await fetchSiteLinks(siteUrl); } catch (e) {
    console.warn("[sync] no se pudo leer el sitemap de la web: %s", (e as Error).message);
    return null;
  }
  if (links.size === 0) return null; // un sitemap vacío es más probable que sea un error que una web sin propiedades
  const { data, error } = await db.from("properties").select("tokko_id, web_url");
  if (error) throw error;
  let changed = 0;
  for (const r of data ?? []) {
    const url = links.get(r.tokko_id as number) ?? null;
    if (url === r.web_url) continue;
    const { error: e } = await db.from("properties").update({ web_url: url }).eq("tokko_id", r.tokko_id);
    if (e) throw e;
    changed++;
  }
  return changed;
}

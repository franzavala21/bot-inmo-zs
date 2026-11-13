// Links de las propiedades en la web de la inmobiliaria, leídos del sitemap.
// La web arma cada página como /propiedad/<texto>-<id de Tokko>/ y el texto tiene que ser exacto (si no, da 404):
// por eso no se arma el link, se toma tal cual del sitemap.
export const DEFAULT_SITE_URL = "https://inmobiliariazavalaseppey.com.ar";

const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

/** Del XML de un sitemap: id de Tokko → URL de la propiedad. Solo URLs del mismo sitio. */
export function propertyLinksFromSitemap(xml: string, siteUrl: string = DEFAULT_SITE_URL): Map<number, string> {
  const host = new URL(siteUrl).host;
  const out = new Map<number, string>();
  for (const loc of locs(xml)) {
    let u: URL;
    try { u = new URL(loc); } catch { continue; }
    if (u.protocol !== "https:" || u.host !== host) continue;
    const m = u.pathname.match(/^\/propiedad\/[a-z0-9-]+-(\d+)\/?$/);
    if (m) out.set(Number(m[1]), u.toString());
  }
  return out;
}

/** Lee el índice de sitemaps y cada sitemap. Si algo falla, tira (quien llama decide qué hacer). */
export async function fetchSiteLinks(siteUrl: string = DEFAULT_SITE_URL, fetchImpl: typeof fetch = fetch): Promise<Map<number, string>> {
  const get = async (url: string) => {
    const r = await fetchImpl(url, { headers: { "User-Agent": "inmo-bot-sync" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`sitemap ${r.status}`);
    return r.text();
  };
  const host = new URL(siteUrl).host;
  const index = await get(new URL("/sitemap-index.xml", siteUrl).toString());
  const maps = locs(index).filter((l) => { try { return new URL(l).host === host; } catch { return false; } });
  const out = new Map<number, string>();
  for (const xml of await Promise.all((maps.length ? maps : []).map(get))) {
    for (const [k, v] of propertyLinksFromSitemap(xml, siteUrl)) out.set(k, v);
  }
  return out;
}

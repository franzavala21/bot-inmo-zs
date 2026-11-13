import { describe, expect, it } from "vitest";
import { fetchSiteLinks, propertyLinksFromSitemap } from "../web/site-links";
import { toFact, type PublicRow } from "../bot/facts";

const SITE = "https://inmobiliariazavalaseppey.com.ar";
const xml = `<urlset>
<url><loc>${SITE}/propiedad/casa-3-dormitorios-en-venta-salsipuedes-7276514/</loc></url>
<url><loc>${SITE}/venta/salsipuedes/</loc></url>
<url><loc>https://otro-sitio.com/propiedad/casa-123/</loc></url>
<url><loc>http://inmobiliariazavalaseppey.com.ar/propiedad/casa-999/</loc></url>
</urlset>`;

describe("links de la web", () => {
  it("toma solo páginas de propiedades del sitio, por id de Tokko", () => {
    const m = propertyLinksFromSitemap(xml, SITE);
    expect([...m.entries()]).toEqual([[7276514, `${SITE}/propiedad/casa-3-dormitorios-en-venta-salsipuedes-7276514/`]]);
  });
  it("lee el índice y cada sitemap", async () => {
    const f = (async (u: string) => new Response(u.endsWith("sitemap-index.xml")
      ? `<sitemapindex><sitemap><loc>${SITE}/sitemap-0.xml</loc></sitemap><sitemap><loc>https://malo.com/x.xml</loc></sitemap></sitemapindex>`
      : xml)) as unknown as typeof fetch;
    expect((await fetchSiteLinks(SITE, f)).size).toBe(1);
  });
  it("el bot manda la página de la inmobiliaria y, si no hay, la ficha", () => {
    const row = { id: "1", tokko_id: 7276514, reference_code: "Z1", public_url: "https://ficha.info/p/x" } as PublicRow;
    expect(toFact({ ...row, web_url: `${SITE}/propiedad/casa-7276514/` }).link).toBe(`${SITE}/propiedad/casa-7276514/`);
    expect(toFact({ ...row, web_url: null }).link).toBe("https://ficha.info/p/x");
  });
});

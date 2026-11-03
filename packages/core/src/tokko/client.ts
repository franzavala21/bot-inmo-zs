// Cliente de solo lectura para la API de Tokko Broker.
// Doc: https://www.tokkobroker.com/api/playground — la clave se saca en Tokko > Mi empresa > Permisos.

const BASE = "https://www.tokkobroker.com/api/v1";

export interface TokkoPage<T> {
  meta: { limit: number; offset: number; total_count: number; next: string | null };
  objects: T[];
}

// Tipado parcial: solo lo que usamos. El objeto completo se guarda en `raw`.
export interface TokkoProperty {
  id: number;
  reference_code?: string;
  publication_title?: string;
  description?: string;
  rich_description?: string;
  address?: string;          // dirección publicada
  real_address?: string;     // dirección real (privada)
  fake_address?: string;
  location?: { name?: string; full_location?: string; short_location?: string };
  type?: { name?: string };
  operations?: { operation_type?: string; prices?: { currency?: string; price?: number }[] }[];
  expenses?: number;
  room_amount?: number;
  suite_amount?: number;
  bathroom_amount?: number;
  total_surface?: string | number;
  roofed_surface?: string | number;
  photos?: { image?: string; is_front_cover?: boolean }[];
  tags?: { name?: string; type?: number }[];
  public_url?: string;
  status?: number;
  internal_data?: unknown;
  producer?: unknown;
  [k: string]: unknown;
}

export class TokkoClient {
  constructor(private key: string, private fetchImpl: typeof fetch = fetch) {
    if (!key) throw new Error("Falta TOKKO_API_KEY");
  }

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    url.searchParams.set("key", this.key);
    url.searchParams.set("format", "json");
    url.searchParams.set("lang", "es_ar");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      // Nunca loguear la URL: lleva la clave.
      throw new Error(`Tokko respondió ${res.status} en ${path}`);
    }
    return (await res.json()) as T;
  }

  /** Trae todas las propiedades paginando de a `pageSize`. */
  async listAllProperties(pageSize = 50): Promise<TokkoProperty[]> {
    const all: TokkoProperty[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.get<TokkoPage<TokkoProperty>>("/property/", { limit: pageSize, offset });
      all.push(...page.objects);
      offset += page.objects.length;
      if (!page.meta.next || page.objects.length === 0 || offset >= page.meta.total_count) break;
    }
    return all;
  }
}

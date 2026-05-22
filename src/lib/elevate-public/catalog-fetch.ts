/**
 * Fetcher server-side del catálogo público Elevate.
 *
 * Fase 1 catálogo enriquecido: la API ahora expone precio_anterior (tachado),
 * promo_label, status_label, is_new, concentración, volumen, género, familia
 * olfativa y notas (en detalle). El adapter mapea al shape `Product` del mock
 * para que los componentes existentes (ProductCard, ProductDetailClient) sigan
 * funcionando sin cambios estructurales — solo extiende con los campos nuevos.
 *
 * Estrategia:
 *   - API es la fuente primaria.
 *   - Si la API devuelve [] o falla, fallback al mock visual.
 */
import {
  products as mockProducts,
  type Product,
  type ProductStatus,
  type ProductCategory,
} from "./products-mock";

type ApiListaProducto = {
  id: string;
  slug: string | null;
  nombre: string | null;
  marca: string | null;
  precio: number;
  precio_anterior: number | null;
  precio_oferta: number | null;
  oferta_hasta: string | null;
  imagen_url: string | null;
  descripcion_corta: string | null;
  destacado: boolean;
  disponible: boolean;
  is_new: boolean;
  promo_label: string | null;
  status_label: "Disponible" | "Últimas unidades" | "Sin stock" | "Próximamente";
  concentracion: string | null;
  volumen_ml: number | null;
  genero: string | null;
  familia_olfativa: string | null;
  orden_web: number | null;
};

export type ApiDetalleProducto = ApiListaProducto & {
  descripcion_web: string | null;
  notas_top: string[];
  notas_heart: string[];
  notas_base: string[];
};

function defaultCategoryFor(brand: string | null): ProductCategory {
  const b = (brand ?? "").toLowerCase();
  if (b.includes("hareem")) return "Árabe Premium";
  if (b.includes("élevé") || b.includes("eleve")) return "Ultranicho";
  if (b.includes("caelum")) return "Nicho";
  return "Diseñador";
}

function statusFromLabel(label: ApiListaProducto["status_label"]): ProductStatus {
  switch (label) {
    case "Próximamente":
      return "soon";
    case "Sin stock":
      return "out";
    case "Últimas unidades":
      return "low";
    case "Disponible":
    default:
      return "available";
  }
}

function buildSize(volumen_ml: number | null): string {
  return typeof volumen_ml === "number" && volumen_ml > 0 ? `${volumen_ml} ml` : "";
}

/**
 * Adapta producto del API público al shape `Product` que usan los
 * componentes web. Para campos que el mock tenía pero la API no devuelve
 * (category, type), se infiere desde marca/familia.
 */
export function apiToMockProduct(api: ApiListaProducto): Product {
  const fromMock = mockProducts.find((m) => m.slug === api.slug);
  return {
    id: api.id,
    slug: api.slug ?? "",
    name: api.nombre ?? "",
    brand: api.marca ?? "",
    category: fromMock?.category ?? defaultCategoryFor(api.marca),
    type: api.familia_olfativa ?? fromMock?.type ?? "",
    price: api.precio,
    oldPrice: api.precio_anterior ?? undefined,
    image: api.imagen_url ?? fromMock?.image ?? "",
    status: statusFromLabel(api.status_label),
    bestseller: api.destacado || fromMock?.bestseller,
    isNew: api.is_new || undefined,
    promo: api.promo_label ?? undefined,
    description: fromMock?.description ?? api.descripcion_corta ?? "",
    notes: fromMock?.notes ?? { top: [], heart: [], base: [] },
    concentration: api.concentracion ?? fromMock?.concentration ?? "",
    size: buildSize(api.volumen_ml) || fromMock?.size || "",
  };
}

/**
 * Adapta detalle del API al shape `Product` con notas pobladas desde DB.
 * Si las notas del API están vacías, mantiene las del mock (compat visual
 * mientras se cargan datos reales).
 */
export function apiDetalleToMockProduct(api: ApiDetalleProducto): Product {
  const base = apiToMockProduct(api);
  const apiNotas = {
    top: api.notas_top ?? [],
    heart: api.notas_heart ?? [],
    base: api.notas_base ?? [],
  };
  const totalApi = apiNotas.top.length + apiNotas.heart.length + apiNotas.base.length;
  return {
    ...base,
    description: api.descripcion_web ?? api.descripcion_corta ?? base.description,
    notes: totalApi > 0 ? apiNotas : base.notes,
  };
}

function resolveOriginEnv(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  return "https://elevate.neura.com.py";
}

async function getOrigin(): Promise<string> {
  // Antes leía `headers()` para inferir el host actual. Eso opta out del
  // Data Cache de Next y obliga a SSR por request. La API pública vive en
  // un host estable (NEXT_PUBLIC_BASE_URL o `https://elevate.neura.com.py`),
  // así que con el env alcanza y la página queda cacheable por revalidate.
  return resolveOriginEnv();
}

export type CatalogFetchResult = {
  products: Product[];
  source: "api" | "mock";
};

/** Listado completo del catálogo público. API primaria, mock fallback. */
export async function fetchCatalog(params?: {
  destacado?: boolean;
  nuevos?: boolean;
  promos?: boolean;
  limit?: number;
}): Promise<CatalogFetchResult> {
  try {
    const origin = await getOrigin();
    const qs = new URLSearchParams({ limit: String(params?.limit ?? 100) });
    if (params?.destacado) qs.set("destacado", "true");
    if (params?.nuevos) qs.set("nuevos", "true");
    if (params?.promos) qs.set("promos", "true");
    const r = await fetch(`${origin}/api/public/elevate/productos?${qs.toString()}`, {
      next: { revalidate: 60 },
    });
    if (!r.ok) return { products: applyFallback(params), source: "mock" };
    const data = (await r.json()) as { productos?: ApiListaProducto[] };
    const list = Array.isArray(data.productos) ? data.productos : [];
    if (list.length === 0) return { products: applyFallback(params), source: "mock" };
    return { products: list.map(apiToMockProduct), source: "api" };
  } catch {
    return { products: applyFallback(params), source: "mock" };
  }
}

/** Detalle por slug. API primaria, mock fallback. Devuelve null si no existe. */
export async function fetchProductoDetalle(
  slug: string
): Promise<{ product: Product; source: "api" | "mock" } | null> {
  try {
    const origin = await getOrigin();
    const r = await fetch(`${origin}/api/public/elevate/productos/${encodeURIComponent(slug)}`, {
      next: { revalidate: 60 },
    });
    if (r.status === 404) {
      const fromMock = mockProducts.find((m) => m.slug === slug);
      return fromMock ? { product: fromMock, source: "mock" } : null;
    }
    if (!r.ok) {
      const fromMock = mockProducts.find((m) => m.slug === slug);
      return fromMock ? { product: fromMock, source: "mock" } : null;
    }
    const data = (await r.json()) as { producto?: ApiDetalleProducto };
    if (!data.producto) {
      const fromMock = mockProducts.find((m) => m.slug === slug);
      return fromMock ? { product: fromMock, source: "mock" } : null;
    }
    return { product: apiDetalleToMockProduct(data.producto), source: "api" };
  } catch {
    const fromMock = mockProducts.find((m) => m.slug === slug);
    return fromMock ? { product: fromMock, source: "mock" } : null;
  }
}

function applyFallback(params?: {
  destacado?: boolean;
  nuevos?: boolean;
  promos?: boolean;
}): Product[] {
  let list = [...mockProducts];
  if (params?.destacado) list = list.filter((p) => p.bestseller);
  if (params?.nuevos) list = list.filter((p) => p.isNew);
  if (params?.promos) list = list.filter((p) => p.oldPrice != null);
  return list;
}

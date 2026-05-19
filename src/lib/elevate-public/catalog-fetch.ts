/**
 * Fetcher server-side para el catálogo público Elevate.
 *
 * Estrategia: API primaria (`/api/public/elevate/productos`) → adaptador a
 * forma del mock para renderizar con `ProductCard` existente. Si la API
 * devuelve vacío o falla, fallback al mock visual.
 *
 * Se llama desde Server Components. No expone secretos.
 */
import { headers } from "next/headers";
import {
  products as mockProducts,
  type Product,
  type ProductStatus,
  type ProductCategory,
} from "./products-mock";

type ApiProducto = {
  id: string;
  slug: string | null;
  nombre: string | null;
  marca: string | null;
  precio: number;
  imagen_url: string | null;
  descripcion_corta: string | null;
  destacado: boolean;
  disponible: boolean;
};

function defaultCategoryFor(brand: string | null): ProductCategory {
  const b = (brand ?? "").toLowerCase();
  if (b.includes("hareem")) return "Árabe Premium";
  if (b.includes("élevé") || b.includes("eleve")) return "Ultranicho";
  if (b.includes("caelum")) return "Nicho";
  return "Diseñador";
}

/**
 * Adapta un producto crudo del API público al shape `Product` que usa
 * `ProductCard`. Los campos ricos que la API no expone (notes,
 * concentration, size, type) se completan con defaults vacíos o derivados
 * del mock por slug si coincide (preserva continuidad visual mientras la
 * DB no tenga esas columnas).
 */
export function apiToMockProduct(api: ApiProducto): Product {
  const fromMock = mockProducts.find((m) => m.slug === api.slug);
  const status: ProductStatus = api.disponible ? "available" : "out";
  return {
    id: api.id,
    slug: api.slug ?? "",
    name: api.nombre ?? "",
    brand: api.marca ?? "",
    category: fromMock?.category ?? defaultCategoryFor(api.marca),
    type: fromMock?.type ?? "",
    price: api.precio,
    oldPrice: fromMock?.oldPrice,
    image: api.imagen_url ?? fromMock?.image ?? "",
    status,
    bestseller: api.destacado || fromMock?.bestseller,
    isNew: fromMock?.isNew,
    promo: fromMock?.promo,
    description: fromMock?.description ?? "",
    notes: fromMock?.notes ?? { top: [], heart: [], base: [] },
    concentration: fromMock?.concentration ?? "",
    size: fromMock?.size ?? "",
  };
}

function resolveOrigin(): string {
  // SSR: el endpoint público vive en el mismo host. En dev/local se permite
  // PUBLIC_BASE_URL como override (no requerido para Hostinger).
  const fromEnv = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv;
  return "https://elevate.neura.com.py";
}

async function getOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host) return `${proto}://${host}`;
  } catch {
    /* fuera de contexto de request — caer a env / hardcoded */
  }
  return resolveOrigin();
}

export type CatalogFetchResult = {
  products: Product[];
  source: "api" | "mock";
};

/**
 * Lista productos del catálogo. Devuelve API si no vacío, mock si API vacía
 * o error.
 */
export async function fetchCatalog(): Promise<CatalogFetchResult> {
  try {
    const origin = await getOrigin();
    const r = await fetch(`${origin}/api/public/elevate/productos?limit=100`, {
      // server-side fetch — cacheo por ISR-like via next.revalidate
      next: { revalidate: 60 },
    });
    if (!r.ok) {
      return { products: mockProducts, source: "mock" };
    }
    const data = (await r.json()) as { productos?: ApiProducto[] };
    const list = Array.isArray(data.productos) ? data.productos : [];
    if (list.length === 0) {
      return { products: mockProducts, source: "mock" };
    }
    return { products: list.map(apiToMockProduct), source: "api" };
  } catch {
    return { products: mockProducts, source: "mock" };
  }
}

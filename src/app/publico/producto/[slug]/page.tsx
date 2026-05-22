import {
  ProductDetailClient,
  ProductNotFoundClient,
} from "@/components/elevate-public/ProductDetailClient";
import { fetchProductoDetalle } from "@/lib/elevate-public/catalog-fetch";

// Dinámico explícito (ver nota en /publico/page.tsx).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const found = await fetchProductoDetalle(slug);
  if (!found) return { title: "Producto no encontrado · Elevate" };
  const p = found.product;
  return {
    title: `${p.name} — ${p.brand} · Elevate`,
    description: p.description,
  };
}

/**
 * Detalle producto. API primaria (incluye descripcion_web, concentración,
 * volumen, género, familia olfativa, pirámide top/heart/base) con fallback
 * al mock cuando la API devuelve 404/error.
 */
export default async function ProductoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const found = await fetchProductoDetalle(slug);
  if (!found) return <ProductNotFoundClient />;
  return <ProductDetailClient product={found.product} />;
}

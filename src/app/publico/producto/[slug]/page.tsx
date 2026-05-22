import {
  ProductDetailClient,
  ProductNotFoundClient,
} from "@/components/elevate-public/ProductDetailClient";
import { fetchProductoDetalle } from "@/lib/elevate-public/catalog-fetch";

// Cache por-slug de 60s. Cada detalle de producto se cachea independiente y
// se rebuilda en background al minuto. Trade-off: los cambios en el ERP se
// reflejan en la web hasta 60s después.
export const revalidate = 60;

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

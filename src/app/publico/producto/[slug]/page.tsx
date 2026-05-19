import { products } from "@/lib/elevate-public/products-mock";
import {
  ProductDetailClient,
  ProductNotFoundClient,
} from "@/components/elevate-public/ProductDetailClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = products.find((p) => p.slug === slug);
  if (!product) {
    return { title: "Producto no encontrado · Elevate" };
  }
  return {
    title: `${product.name} — ${product.brand} · Elevate`,
    description: product.description,
  };
}

/**
 * Detalle de producto. Fase 2: mock visual. Cuando se conecte a API real,
 * reemplazar `products.find` por fetch a `/api/public/elevate/productos/[slug]`.
 */
export default async function ProductoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = products.find((p) => p.slug === slug);
  if (!product) return <ProductNotFoundClient />;
  return <ProductDetailClient product={product} />;
}

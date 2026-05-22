import { fetchCatalog, fetchCategoriasPublic } from "@/lib/elevate-public/catalog-fetch";
import { CatalogClient } from "./CatalogClient";

export const metadata = {
  title: "Catálogo · Elevate Maison de Parfum",
  description:
    "Explorá nuestra curaduría completa de perfumes nicho, ultranicho, de diseñador y árabes premium.",
};

// Dinámico explícito (ver nota en /publico/page.tsx): evita el cuelgue del
// prerender durante `next build` por self-fetch al API pública.
export const dynamic = "force-dynamic";

/**
 * Catálogo público — server component.
 *
 * Fetchea desde `/api/public/elevate/productos` (server-side). Si la API
 * devuelve [] o falla, cae al mock visual. El client component
 * (CatalogClient) recibe la lista ya resuelta y maneja filtros + búsqueda.
 */
export default async function CatalogoPage() {
  const [{ products }, categorias] = await Promise.all([
    fetchCatalog(),
    fetchCategoriasPublic(),
  ]);
  return <CatalogClient products={products} categorias={categorias} />;
}

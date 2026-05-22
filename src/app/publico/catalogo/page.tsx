import { fetchCatalog } from "@/lib/elevate-public/catalog-fetch";
import { CatalogClient } from "./CatalogClient";

export const metadata = {
  title: "Catálogo · Elevate Maison de Parfum",
  description:
    "Explorá nuestra curaduría completa de perfumes nicho, ultranicho, de diseñador y árabes premium.",
};

// Cache de 60s: el listado público de catálogo se rebuilda en background
// cada minuto. Reduce CPU drásticamente vs `force-dynamic`. Trade-off: los
// cambios en el ERP se reflejan en la web hasta 60s después.
export const revalidate = 60;

/**
 * Catálogo público — server component.
 *
 * Fetchea desde `/api/public/elevate/productos` (server-side). Si la API
 * devuelve [] o falla, cae al mock visual. El client component
 * (CatalogClient) recibe la lista ya resuelta y maneja filtros + búsqueda.
 */
export default async function CatalogoPage() {
  const { products } = await fetchCatalog();
  return <CatalogClient products={products} />;
}

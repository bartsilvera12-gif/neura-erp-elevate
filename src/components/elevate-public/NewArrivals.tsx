import { ProductCard } from "./ProductCard";
import { SectionTitle } from "./SectionTitle";
import type { Product } from "@/lib/elevate-public/products-mock";

/**
 * Sección NewArrivals. Recibe `products` con `isNew=true` filtrados.
 */
export function NewArrivals({ products }: { products: Product[] }) {
  if (products.length === 0) return null;
  return (
    <section id="nuevos" className="py-24 lg:py-32 bg-cream/40">
      <div className="container mx-auto px-6 lg:px-10">
        <SectionTitle
          eyebrow="Recién llegados"
          title="Nuevas incorporaciones"
          subtitle="Descubrí las fragancias recién incorporadas a nuestra selección."
        />
        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7 max-w-5xl mx-auto">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

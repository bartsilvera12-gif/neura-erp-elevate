import { ProductCard } from "./ProductCard";
import { SectionTitle } from "./SectionTitle";
import type { Product } from "@/lib/elevate-public/products-mock";

/**
 * Sección Promos. Recibe `products` con `oldPrice` ya filtrados desde el
 * server component.
 */
export function Promos({ products }: { products: Product[] }) {
  if (products.length === 0) return null;
  return (
    <section
      id="promociones"
      className="py-24 lg:py-32 gradient-bordeaux text-cream relative overflow-hidden"
    >
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--gold))_0%,transparent_50%)]" />
      <div className="container mx-auto px-6 lg:px-10 relative">
        <SectionTitle
          light
          eyebrow="Promociones"
          title="Selecciones por tiempo limitado"
          subtitle="Una oportunidad de incorporar piezas codiciadas a un precio excepcional."
        />
        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
          {products.map((p) => (
            <div key={p.id} className="promo-card">
              <ProductCard product={p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

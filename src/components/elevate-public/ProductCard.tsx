"use client";

import Link from "next/link";
import Image from "next/image";
import { type Product, formatPrice } from "@/lib/elevate-public/products-mock";
import { trackProductEvent } from "@/lib/elevate-public/track";
import { useCart } from "./CartContext";
import { UsdEquivalent } from "./UsdEquivalent";
import { MayoristaLine } from "./MayoristaLine";

const statusMap: Record<Product["status"], { label: string; cls: string }> = {
  available: { label: "Disponible", cls: "text-gold border-gold/40" },
  low: { label: "Stock bajo", cls: "text-primary border-primary/40" },
  out: { label: "Sin stock", cls: "text-muted-foreground border-muted-foreground/30" },
  soon: { label: "Próximamente", cls: "text-foreground/70 border-foreground/30" },
};

export function ProductCard({ product }: { product: Product }) {
  const s = statusMap[product.status];
  const disabled = product.status === "out" || product.status === "soon";
  const { add } = useCart();

  return (
    <article className="group relative bg-background border border-border/60 hover:border-gold/60 transition-elegant shadow-soft hover:shadow-elegant flex flex-col overflow-hidden">
      <Link
        href={`/producto/${product.slug}`}
        onClick={() =>
          trackProductEvent({
            product_id: product.id,
            event_type: "product_click",
            source: "catalogo",
            metadata: { slug: product.slug, name: product.name },
          })
        }
        className="relative aspect-[4/5] overflow-hidden bg-cream block"
        aria-label={`Ver ${product.name}`}
      >
        <Image
          src={product.image}
          alt={`${product.name} de ${product.brand}`}
          fill
          sizes="(min-width:1024px) 25vw, (min-width:768px) 33vw, 100vw"
          className="object-cover transition-elegant group-hover:scale-105"
          // unoptimized: la imagen ya viene del bucket público de Supabase
          // Storage, lista para servir. Evita /_next/image y libera el CPU
          // del Node de Hostinger (era el cuello de botella post-deploy).
          unoptimized
        />
        {product.promo && (
          <span className="absolute top-4 left-4 bg-primary text-primary-foreground text-[10px] tracking-[0.25em] uppercase px-3 py-1.5">
            {product.promo}
          </span>
        )}
        {product.isNew && !product.promo && (
          <span className="absolute top-4 left-4 bg-gold text-gold-foreground text-[10px] tracking-[0.25em] uppercase px-3 py-1.5">
            Nuevo
          </span>
        )}
        <span
          className={`absolute top-4 right-4 bg-background/90 text-[10px] tracking-[0.2em] uppercase px-2.5 py-1 border ${s.cls}`}
        >
          {s.label}
        </span>
      </Link>

      <div className="p-6 flex flex-col gap-2 flex-1">
        <div className="text-[10px] tracking-[0.3em] uppercase text-gold">{product.brand}</div>
        <Link href={`/producto/${product.slug}`} className="hover:text-primary transition-elegant">
          <h3 className="font-display text-xl text-foreground leading-tight">{product.name}</h3>
        </Link>
        <div className="text-sm text-muted-foreground italic font-editorial">{product.type}</div>

        <div className="mt-3 flex items-baseline gap-3">
          {product.oldPrice && (
            <span className="text-sm text-muted-foreground line-through">
              {formatPrice(product.oldPrice)}
            </span>
          )}
          <span className="text-lg text-primary font-medium">{formatPrice(product.price)}</span>
        </div>
        <UsdEquivalent priceGs={product.price} className="mt-0.5" />
        <MayoristaLine mayorista={product.mayorista} className="mt-0.5 block" />

        <div className="mt-auto pt-5">
          <button
            type="button"
            onClick={() => {
              if (disabled) return;
              add(product);
              trackProductEvent({
                product_id: product.id,
                event_type: "add_to_cart",
                source: "catalogo",
              });
            }}
            disabled={disabled}
            className={`w-full text-[11px] tracking-[0.3em] uppercase py-3 transition-elegant ${
              disabled
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary-glow shadow-soft"
            }`}
          >
            {disabled ? "No disponible" : "Agregar al carrito"}
          </button>
        </div>
      </div>
    </article>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Minus, Plus, ChevronLeft, ShoppingBag } from "lucide-react";
import { type Product, formatPrice, buildWhatsAppLink, products } from "@/lib/elevate-public/products-mock";
import { useCart } from "./CartContext";
import { ProductCard } from "./ProductCard";
import { SectionTitle } from "./SectionTitle";

const statusMap = {
  available: { label: "Disponible", cls: "text-gold border-gold/40" },
  low: { label: "Stock bajo", cls: "text-primary border-primary/40" },
  out: { label: "Sin stock", cls: "text-muted-foreground border-muted-foreground/30" },
  soon: { label: "Próximamente", cls: "text-foreground/70 border-foreground/30" },
} as const;

export function ProductDetailClient({ product }: { product: Product }) {
  const router = useRouter();
  const { add, setOpen } = useCart();
  const [qty, setQty] = useState(1);

  const s = statusMap[product.status];
  const disabled = product.status === "out" || product.status === "soon";
  const related = products
    .filter((p) => p.id !== product.id && p.category === product.category)
    .slice(0, 3);

  const handleAdd = () => {
    if (disabled) return;
    add(product, qty);
  };

  return (
    <>
      <section className="pt-32 pb-20 lg:pb-28">
        <div className="container mx-auto px-6 lg:px-10">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-[11px] tracking-[0.3em] uppercase text-muted-foreground hover:text-primary mb-10 transition-elegant"
          >
            <ChevronLeft size={14} /> Volver
          </button>

          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
            <div className="relative bg-cream overflow-hidden shadow-elegant">
              <div className="aspect-[4/5] relative">
                <Image
                  src={product.image}
                  alt={`${product.name} de ${product.brand}`}
                  fill
                  sizes="(min-width:1024px) 50vw, 100vw"
                  priority
                  className="object-cover"
                />
              </div>
              {product.promo && (
                <span className="absolute top-6 left-6 bg-primary text-primary-foreground text-[10px] tracking-[0.25em] uppercase px-3 py-1.5">
                  {product.promo}
                </span>
              )}
              {product.isNew && !product.promo && (
                <span className="absolute top-6 left-6 bg-gold text-gold-foreground text-[10px] tracking-[0.25em] uppercase px-3 py-1.5">
                  Nuevo
                </span>
              )}
            </div>

            <div className="flex flex-col">
              <div className="text-[11px] tracking-[0.4em] uppercase text-gold mb-3">{product.brand}</div>
              <h1 className="font-display text-4xl lg:text-5xl text-primary leading-tight">{product.name}</h1>
              <p className="font-editorial italic text-lg text-muted-foreground mt-3">{product.type}</p>

              <div
                className={`inline-flex self-start mt-5 text-[10px] tracking-[0.25em] uppercase px-2.5 py-1 border bg-background ${s.cls}`}
              >
                {s.label}
              </div>

              <div className="mt-6 flex items-baseline gap-4">
                {product.oldPrice && (
                  <span className="text-lg text-muted-foreground line-through">
                    {formatPrice(product.oldPrice)}
                  </span>
                )}
                <span className="font-display text-3xl text-primary">{formatPrice(product.price)}</span>
              </div>

              <div className="h-px bg-border my-8" />

              <p className="text-foreground/80 leading-relaxed">{product.description}</p>

              <dl className="grid grid-cols-2 gap-6 mt-8 text-sm">
                <div>
                  <dt className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1">
                    Concentración
                  </dt>
                  <dd className="text-primary">{product.concentration}</dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1">Tamaño</dt>
                  <dd className="text-primary">{product.size}</dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1">Categoría</dt>
                  <dd className="text-primary">{product.category}</dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-1">Familia</dt>
                  <dd className="text-primary">{product.type}</dd>
                </div>
              </dl>

              <div className="mt-8">
                <h2 className="text-[11px] tracking-[0.3em] uppercase text-gold mb-4">Pirámide olfativa</h2>
                <div className="space-y-3">
                  {[
                    { k: "Salida", v: product.notes.top },
                    { k: "Corazón", v: product.notes.heart },
                    { k: "Fondo", v: product.notes.base },
                  ].map((row) => (
                    <div
                      key={row.k}
                      className="grid grid-cols-[100px_1fr] gap-4 items-baseline border-b border-border/60 pb-2"
                    >
                      <span className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">{row.k}</span>
                      <span className="font-editorial italic text-foreground/85">{row.v.join(" · ")}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-10 flex flex-col sm:flex-row gap-4 items-stretch">
                <div className="flex items-center justify-between border border-border bg-background px-2 sm:w-40">
                  <button
                    type="button"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={disabled}
                    className="p-3 hover:text-primary text-foreground/70 disabled:opacity-40"
                    aria-label="Restar cantidad"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="text-base text-primary min-w-[2ch] text-center">{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty((q) => q + 1)}
                    disabled={disabled}
                    className="p-3 hover:text-primary text-foreground/70 disabled:opacity-40"
                    aria-label="Sumar cantidad"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={disabled}
                  className={`flex-1 inline-flex items-center justify-center gap-3 py-4 text-[11px] tracking-[0.3em] uppercase transition-elegant shadow-soft ${
                    disabled
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-primary text-primary-foreground hover:bg-primary-glow"
                  }`}
                >
                  <ShoppingBag size={16} />
                  {disabled ? "No disponible" : `Agregar al carrito · ${formatPrice(product.price * qty)}`}
                </button>
              </div>

              {!disabled && (
                <button
                  type="button"
                  onClick={() => {
                    add(product, qty);
                    setOpen(false);
                    router.push("/checkout");
                  }}
                  className="mt-3 py-4 text-[11px] tracking-[0.3em] uppercase border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-elegant"
                >
                  Comprar ahora
                </button>
              )}

              <a
                href={buildWhatsAppLink(product.name, product.price)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 text-center py-3 text-[11px] tracking-[0.3em] uppercase text-muted-foreground hover:text-primary transition-elegant"
              >
                Consultar por WhatsApp
              </a>
            </div>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="py-20 bg-cream/40">
          <div className="container mx-auto px-6 lg:px-10">
            <SectionTitle eyebrow="También te puede interesar" title="Fragancias relacionadas" />
            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7 max-w-5xl mx-auto">
              {related.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

export function ProductNotFoundClient() {
  return (
    <div className="container mx-auto px-6 py-32 text-center">
      <h1 className="font-display text-4xl text-primary mb-4">Producto no encontrado</h1>
      <p className="text-muted-foreground mb-8">La fragancia que buscás no está disponible.</p>
      <Link
        href="/catalogo"
        className="inline-block px-8 py-3 bg-primary text-primary-foreground text-[11px] tracking-[0.3em] uppercase hover:bg-primary-glow transition-elegant"
      >
        Volver al catálogo
      </Link>
    </div>
  );
}

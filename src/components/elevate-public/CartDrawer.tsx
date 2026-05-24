"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { X, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/elevate-public/products-mock";
import { useCart } from "./CartContext";

export function CartDrawer() {
  const { open, setOpen, items, setQty, remove, total, count } = useCart();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div
        onClick={() => setOpen(false)}
        className={`fixed inset-0 bg-primary/40 backdrop-blur-sm z-[60] transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Carrito de compras"
        className={`fixed top-0 right-0 h-full w-full sm:w-[440px] bg-background z-[70] shadow-elegant transition-transform duration-500 flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <div className="text-[10px] tracking-[0.4em] uppercase text-gold">Tu selección</div>
            <h2 className="font-display text-2xl text-primary mt-1">Carrito ({count})</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="p-2 hover:text-primary text-foreground/60"
          >
            <X />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-4 py-20">
              <ShoppingBag size={40} className="text-gold/60" />
              <p className="font-editorial italic text-lg">Tu carrito está vacío.</p>
              <Link
                href="/catalogo"
                onClick={() => setOpen(false)}
                className="mt-2 px-6 py-3 border border-primary text-primary text-[11px] tracking-[0.3em] uppercase hover:bg-primary hover:text-primary-foreground transition-elegant"
              >
                Explorar catálogo
              </Link>
            </div>
          ) : (
            <ul className="space-y-5">
              {items.map((i) => (
                <li key={i.product.id} className="flex gap-4 pb-5 border-b border-border/60">
                  <div className="relative w-20 h-24 shrink-0 bg-cream">
                    <Image
                      src={i.product.image}
                      alt={i.product.name}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] tracking-[0.25em] uppercase text-gold">{i.product.brand}</div>
                    <div className="font-display text-base text-primary mt-1">{i.product.name}</div>
                    <div className="text-xs text-muted-foreground italic font-editorial">{i.product.size}</div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center border border-border">
                        <button
                          type="button"
                          onClick={() => setQty(i.product.id, i.qty - 1)}
                          className="p-2 hover:bg-cream text-foreground/70"
                          aria-label="Restar"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="px-3 text-sm">{i.qty}</span>
                        <button
                          type="button"
                          onClick={() => setQty(i.product.id, i.qty + 1)}
                          className="p-2 hover:bg-cream text-foreground/70"
                          aria-label="Sumar"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <div className="text-sm text-primary font-medium">
                        {formatPrice(i.product.price * i.qty)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(i.product.id)}
                      aria-label={`Quitar ${i.product.name} del carrito`}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.25em] uppercase text-muted-foreground hover:text-red-600 mt-2 transition-colors"
                    >
                      <Trash2 size={12} aria-hidden="true" />
                      Quitar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="p-6 border-t border-border bg-cream/30">
            <div className="flex justify-between items-baseline mb-4">
              <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground">Subtotal</span>
              <span className="font-display text-2xl text-primary">{formatPrice(total)}</span>
            </div>
            <Link
              href="/checkout"
              onClick={() => setOpen(false)}
              className="block text-center bg-primary text-primary-foreground py-4 text-[11px] tracking-[0.3em] uppercase hover:bg-primary-glow transition-elegant shadow-soft"
            >
              Finalizar compra
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full text-center mt-3 text-[10px] tracking-[0.3em] uppercase text-muted-foreground hover:text-primary"
            >
              Seguir explorando
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, MessageCircle } from "lucide-react";
import { formatPrice } from "@/lib/elevate-public/products-mock";

interface Order {
  id: string;
  createdAt: string;
  items: { name: string; brand: string; qty: number; price: number }[];
  total: number;
  customer: { name: string; email: string; address: string; city: string };
}

export function ConfirmacionClient() {
  const params = useSearchParams();
  const orderId = params.get("order");
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? sessionStorage.getItem("elevate-last-order") : null;
      if (raw) setOrder(JSON.parse(raw) as Order);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <section className="pt-32 pb-24 min-h-[80vh] bg-gradient-to-b from-cream/40 to-background">
      <div className="container mx-auto px-6 lg:px-10 max-w-3xl">
        <div className="text-center mb-12 animate-fade-up">
          <div className="inline-flex items-center justify-center h-20 w-20 rounded-full bg-gold/15 border border-gold/40 mb-6">
            <Check size={36} className="text-gold" />
          </div>
          <span className="text-xs tracking-[0.4em] uppercase text-gold">Orden confirmada</span>
          <h1 className="font-display text-4xl md:text-5xl text-primary mt-3 text-balance">
            Gracias por elegir Elevate
          </h1>
          <div className="gold-divider w-24 mx-auto my-6" />
          <p className="font-editorial italic text-lg text-muted-foreground max-w-xl mx-auto">
            Tu orden{" "}
            <span className="text-primary not-italic font-medium">{orderId ?? "—"}</span>{" "}
            fue recibida. Te contactaremos por WhatsApp para coordinar el envío y confirmar el pago.
          </p>
        </div>

        {order && (
          <div className="bg-background border border-border p-8 lg:p-10 shadow-soft">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-display text-2xl text-primary">Detalle de la orden</h2>
              <span className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">
                {new Date(order.createdAt).toLocaleDateString("es-AR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>

            <ul className="divide-y divide-border">
              {order.items.map((it, i) => (
                <li key={i} className="py-4 flex justify-between gap-4">
                  <div>
                    <div className="text-[10px] tracking-[0.25em] uppercase text-gold">{it.brand}</div>
                    <div className="font-display text-base text-primary">{it.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">Cantidad: {it.qty}</div>
                  </div>
                  <div className="text-primary font-medium">{formatPrice(it.price * it.qty)}</div>
                </li>
              ))}
            </ul>

            <div className="flex justify-between items-baseline border-t border-border pt-5 mt-2">
              <span className="text-xs tracking-[0.3em] uppercase">Total</span>
              <span className="font-display text-3xl text-primary">{formatPrice(order.total)}</span>
            </div>

            <div className="mt-8 pt-8 border-t border-border grid sm:grid-cols-2 gap-6 text-sm">
              <div>
                <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-2">Cliente</div>
                <div className="text-foreground">{order.customer.name}</div>
                <div className="text-muted-foreground">{order.customer.email}</div>
              </div>
              <div>
                <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-2">Envío</div>
                <div className="text-foreground">{order.customer.address}</div>
                <div className="text-muted-foreground">{order.customer.city}</div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/catalogo"
            className="inline-flex items-center justify-center px-8 py-4 border border-primary text-primary text-xs tracking-[0.3em] uppercase hover:bg-primary hover:text-primary-foreground transition-elegant"
          >
            Seguir explorando
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-gold text-gold-foreground text-xs tracking-[0.3em] uppercase hover:bg-primary hover:text-primary-foreground transition-elegant shadow-soft"
          >
            <MessageCircle size={14} /> Volver al inicio
          </Link>
        </div>
      </div>
    </section>
  );
}

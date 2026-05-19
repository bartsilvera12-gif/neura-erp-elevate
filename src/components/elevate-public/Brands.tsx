import Link from "next/link";
import { brands } from "@/lib/elevate-public/products-mock";
import { SectionTitle } from "./SectionTitle";

export function Brands() {
  return (
    <section id="marcas" className="py-24 lg:py-32 bg-background">
      <div className="container mx-auto px-6 lg:px-10">
        <SectionTitle
          eyebrow="Marcas"
          title="Maisons que elegimos"
          subtitle="Una curaduría global: del nicho confidencial al árabe ceremonial."
        />
        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {brands.map((b) => (
            <Link
              key={b.name}
              href="/catalogo"
              className="group relative overflow-hidden border border-border/60 hover:border-gold transition-elegant aspect-[3/4] flex flex-col justify-end p-8 bg-cream/40 hover:shadow-elegant"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-gold/10 group-hover:from-primary/15 transition-elegant" />
              <div className="absolute top-6 right-6 text-[10px] tracking-[0.3em] uppercase text-gold">
                {b.category}
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-display text-5xl text-primary/10 group-hover:text-primary/20 transition-elegant">
                {b.name.charAt(0)}
              </div>
              <div className="relative">
                <h3 className="font-display text-2xl text-primary">{b.name}</h3>
                <div className="gold-divider w-12 my-3" />
                <p className="text-sm text-muted-foreground font-editorial italic">{b.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

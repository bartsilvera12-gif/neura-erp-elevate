import Link from "next/link";
import { Hero } from "@/components/elevate-public/Hero";

/**
 * Home pública Elevate. Hero ocupa min-h-screen (corre por debajo del Header
 * fixed). CTA al catálogo cierra la página antes del Footer global.
 *
 * Bestsellers / NewArrivals / Reviews / Promos de la repo original quedan
 * fuera de scope en Fase 2 (se incorporan cuando esté el catálogo real
 * conectado, Fase 3+).
 */
export default function ElevatePublicHome() {
  return (
    <>
      <Hero />

      <section className="py-24 lg:py-32 bg-cream/30">
        <div className="container mx-auto px-6 lg:px-10 text-center max-w-2xl">
          <span className="text-xs tracking-[0.4em] uppercase text-gold">
            Catálogo completo
          </span>
          <h2 className="font-display text-4xl md:text-5xl text-primary mt-4 text-balance">
            Explorá toda nuestra curaduría
          </h2>
          <div className="gold-divider w-24 mx-auto my-6" />
          <p className="font-editorial italic text-lg text-muted-foreground">
            Filtrá por marca, categoría, familia olfativa o buscá por nombre.
            Todas las fragancias seleccionadas en un solo lugar.
          </p>
          <Link
            href="/catalogo"
            className="inline-flex items-center justify-center mt-8 px-10 py-4 bg-primary text-primary-foreground text-xs tracking-[0.3em] uppercase hover:bg-primary-glow transition-elegant shadow-elegant"
          >
            Ir al catálogo
          </Link>
        </div>
      </section>
    </>
  );
}

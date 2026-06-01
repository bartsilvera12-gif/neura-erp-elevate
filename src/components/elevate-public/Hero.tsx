import Image from "next/image";
import Link from "next/link";

/**
 * Hero pública Elevate.
 * Asset activo: `public/brand/elevate/hero-perfume-v2.png`.
 * Backup del anterior queda en `public/brand/elevate/hero-perfume.jpg`
 * por si hay que revertir.
 */
export function Hero() {
  return (
    <section id="top" className="relative min-h-[100svh] flex items-center overflow-hidden">
      <div className="absolute inset-0">
        <Image
          src="/brand/elevate/hero-perfume-v2.png"
          alt="Perfume de lujo Elevate"
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/85 via-primary/55 to-primary/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-transparent to-transparent" />
      </div>

      <div className="relative container mx-auto px-6 lg:px-10 pt-32 pb-20 md:py-32 lg:py-40">
        <div className="max-w-2xl animate-fade-up">
          <h1 className="font-display text-4xl md:text-7xl lg:text-8xl text-cream leading-[0.95] text-balance">
            Elevate
          </h1>
          <p className="font-editorial italic text-xl md:text-3xl text-gold-light mt-3">
            La esencia de tu próximo negocio.
          </p>
          <div className="gold-divider w-32 md:w-40 my-6 md:my-8" />
          <p className="text-cream/90 text-sm md:text-lg max-w-xl leading-relaxed">
            Fragancias seleccionadas para quienes buscan elegancia, presencia y exclusividad.
            Una curaduría de perfumes nicho, ultranicho, de diseñador y árabes premium.
          </p>

          <div className="mt-8 md:mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Link
              href="/catalogo"
              className="inline-flex w-full sm:w-auto items-center justify-center px-8 py-4 bg-cream text-primary text-xs tracking-[0.3em] uppercase hover:bg-gold hover:text-cream transition-elegant shadow-elegant"
            >
              Ver catálogo
            </Link>
            <Link
              href="/marcas"
              className="inline-flex w-full sm:w-auto items-center justify-center px-8 py-4 border border-gold/60 text-cream text-xs tracking-[0.3em] uppercase hover:bg-gold/10 transition-elegant"
            >
              Explorar marcas
            </Link>
          </div>
        </div>
      </div>

      {/* En mobile el indicador se sube para no chocar con el WhatsApp flotante
          y el safe-area inferior del navegador. */}
      <div className="absolute bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 text-cream/60 text-[10px] tracking-[0.4em] uppercase">
        Descubrí más ↓
      </div>
    </section>
  );
}

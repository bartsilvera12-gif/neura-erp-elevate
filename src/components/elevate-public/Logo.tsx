import Image from "next/image";
import Link from "next/link";

/**
 * Logo Elevate. Variante `dark` para fondo claro (default), `light` para
 * fondo bordeaux. Asset en `public/brand/elevate/elevate-logo-gold.png`.
 */
export function Logo({ variant = "dark" }: { variant?: "dark" | "light" }) {
  return (
    <Link href="/" className="flex items-center gap-3 group" aria-label="Elevate inicio">
      <Image
        src="/brand/elevate/elevate-logo-gold.png"
        alt="Elevate logo"
        width={96}
        height={96}
        className="h-20 w-20 md:h-24 md:w-24 object-contain"
        priority
      />
      <div className="leading-none">
        <div
          className={`font-display text-2xl tracking-[0.18em] ${
            variant === "light" ? "text-cream" : "text-primary"
          }`}
        >
          ELEVATE
        </div>
        <div
          className={`text-[10px] tracking-[0.3em] mt-1 ${
            variant === "light" ? "text-gold-light" : "text-gold"
          }`}
        >
          La esencia de tu próximo momento
        </div>
      </div>
    </Link>
  );
}

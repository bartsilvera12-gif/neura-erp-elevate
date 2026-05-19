import Link from "next/link";

/**
 * Header de la web pública de Elevate.
 * Fase 1: shell visual mínimo. No carrito, no auth, no menú móvil aún.
 */
const NAV_LINKS = [
  { href: "/", label: "Inicio" },
  { href: "/catalogo", label: "Catálogo" },
  { href: "/marcas", label: "Marcas" },
  { href: "/nosotros", label: "Nosotros" },
  { href: "/faq", label: "FAQ" },
];

export default function ElevatePublicHeader() {
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-semibold tracking-tight text-neutral-900">
          Elevate
        </Link>
        <nav className="hidden gap-6 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-sm text-neutral-600 transition hover:text-neutral-900"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/checkout"
          className="rounded-full border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-900 transition hover:border-neutral-900"
        >
          Carrito
        </Link>
      </div>
    </header>
  );
}

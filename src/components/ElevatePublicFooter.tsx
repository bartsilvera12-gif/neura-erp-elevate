import Link from "next/link";

/**
 * Footer de la web pública de Elevate. Shell mínimo de Fase 1.
 */
export default function ElevatePublicFooter() {
  return (
    <footer className="mt-16 border-t border-neutral-200 bg-neutral-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 md:flex-row md:items-start md:justify-between">
        <div className="text-sm text-neutral-600">
          <p className="font-semibold text-neutral-900">Elevate</p>
          <p className="mt-1">Perfumería boutique.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-600">
          <Link href="/" className="hover:text-neutral-900">Inicio</Link>
          <Link href="/catalogo" className="hover:text-neutral-900">Catálogo</Link>
          <Link href="/marcas" className="hover:text-neutral-900">Marcas</Link>
          <Link href="/nosotros" className="hover:text-neutral-900">Nosotros</Link>
          <Link href="/faq" className="hover:text-neutral-900">FAQ</Link>
        </nav>
        <div className="text-xs text-neutral-500">
          © {new Date().getFullYear()} Elevate
        </div>
      </div>
    </footer>
  );
}

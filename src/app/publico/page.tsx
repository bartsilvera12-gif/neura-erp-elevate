import Link from "next/link";

export default function ElevatePublicHome() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
        Elevate · Perfumería boutique
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-neutral-900 md:text-5xl">
        Fragancias seleccionadas, entrega rápida.
      </h1>
      <p className="mt-4 max-w-2xl text-neutral-600">
        Esta es la shell pública de Elevate (Fase 1). El catálogo real, el carrito
        y el checkout se conectan en las próximas fases.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/catalogo"
          className="rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          Ver catálogo
        </Link>
        <Link
          href="/marcas"
          className="rounded-full border border-neutral-300 px-6 py-3 text-sm font-medium text-neutral-900 transition hover:border-neutral-900"
        >
          Marcas
        </Link>
      </div>
    </section>
  );
}

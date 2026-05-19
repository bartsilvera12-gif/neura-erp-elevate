type Params = { slug: string };

export const dynamic = "force-dynamic";

export default async function ElevatePublicProducto({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-xs uppercase tracking-widest text-neutral-500">Producto</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900">
        {slug}
      </h1>
      <p className="mt-3 text-neutral-600">
        Detalle del producto. (Fase 1: shell — la data real llega en Fase 3.)
      </p>
    </section>
  );
}

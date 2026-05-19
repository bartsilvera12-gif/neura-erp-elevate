import { SectionTitle } from "./SectionTitle";

const policies = [
  {
    title: "Política de Devolución",
    items: [
      "Devoluciones aceptadas dentro de los 7 días posteriores a la recepción.",
      "El producto debe estar sin uso, con su empaque original y precintos intactos.",
      "El reintegro se realiza por el mismo medio de pago original.",
      "El costo de envío de devolución corre por cuenta del cliente, salvo defecto comprobado.",
    ],
  },
  {
    title: "Política de Envío",
    items: [
      "Envíos a todo el país mediante operadores logísticos premium.",
      "Tiempos: CABA y GBA 24-48 hs · Interior 3-7 días hábiles.",
      "Envío express disponible con costo adicional.",
      "Seguimiento personalizado por WhatsApp en cada etapa.",
    ],
  },
];

export function Policies() {
  return (
    <section id="politicas" className="py-24 lg:py-32 bg-background">
      <div className="container mx-auto px-6 lg:px-10">
        <SectionTitle eyebrow="Políticas" title="Compra con tranquilidad" />
        <div className="mt-14 grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {policies.map((p) => (
            <div
              key={p.title}
              className="border border-border p-8 lg:p-10 bg-cream/30 hover:border-gold transition-elegant"
            >
              <h3 className="font-display text-2xl text-primary">{p.title}</h3>
              <div className="gold-divider w-12 my-5" />
              <ul className="space-y-3">
                {p.items.map((it, i) => (
                  <li key={i} className="flex gap-3 text-foreground/80 text-sm leading-relaxed">
                    <span className="text-gold mt-1">◆</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { SectionTitle } from "./SectionTitle";

const reviews = [
  { name: "Camila R.", text: "Elevate me asesoró de manera impecable. El perfume llegó original y el packaging fue una experiencia en sí mismo.", role: "Buenos Aires" },
  { name: "Martín F.", text: "Por fin encontré una perfumería que entiende lo que es una fragancia nicho. Atención personalizada y producto impecable.", role: "Córdoba" },
  { name: "Lucía M.", text: "El Oud Royale superó todas mis expectativas. Persistencia y elegancia en cada nota. Volveré sin dudar.", role: "Rosario" },
  { name: "Valentina S.", text: "Una boutique digital que se siente como entrar a una atelier de París. Cada detalle cuidado.", role: "Mendoza" },
];

export function Reviews() {
  return (
    <section id="resenas" className="py-24 lg:py-32 bg-cream/30">
      <div className="container mx-auto px-6 lg:px-10">
        <SectionTitle
          eyebrow="Reseñas"
          title="Clientes que ya elevaron su esencia"
          subtitle="Voces de quienes ya confían en nuestra curaduría."
        />
        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {reviews.map((r) => (
            <figure
              key={r.name}
              className="bg-background p-8 lg:p-10 border border-border/60 shadow-soft hover:shadow-elegant transition-elegant relative"
            >
              <div className="absolute top-6 right-8 font-display text-7xl text-gold/20 leading-none">&ldquo;</div>
              <blockquote className="font-editorial italic text-xl text-foreground/85 leading-relaxed">
                {r.text}
              </blockquote>
              <div className="gold-divider w-12 my-5" />
              <figcaption>
                <div className="font-display text-lg text-primary">{r.name}</div>
                <div className="text-xs tracking-[0.25em] uppercase text-muted-foreground mt-1">{r.role}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

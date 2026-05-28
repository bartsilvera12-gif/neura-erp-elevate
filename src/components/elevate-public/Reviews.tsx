import { SectionTitle } from "./SectionTitle";

export type ResenaVideo = {
  id: string;
  titulo: string | null;
  descripcion: string | null;
  video_url: string;
  poster_url: string | null;
  orden: number;
};

const fallbackTextos = [
  { name: "Camila R.", text: "Elevate me asesoró de manera impecable. El perfume llegó original y el packaging fue una experiencia en sí mismo.", role: "Buenos Aires" },
  { name: "Martín F.", text: "Por fin encontré una perfumería que entiende lo que es una fragancia nicho. Atención personalizada y producto impecable.", role: "Córdoba" },
  { name: "Lucía M.", text: "El Oud Royale superó todas mis expectativas. Persistencia y elegancia en cada nota. Volveré sin dudar.", role: "Rosario" },
  { name: "Valentina S.", text: "Una boutique digital que se siente como entrar a una atelier de París. Cada detalle cuidado.", role: "Mendoza" },
];

function gridColsFor(n: number): string {
  if (n <= 1) return "grid-cols-1 max-w-md mx-auto";
  if (n === 2) return "grid-cols-1 md:grid-cols-2 max-w-3xl mx-auto";
  if (n === 3) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto";
  // 4 videos: usar todo el ancho del wrapper grande para que se vean al
  // máximo, con un cap defensivo de ~1500 px para pantallas muy anchas.
  return "grid-cols-1 md:grid-cols-2 lg:grid-cols-4 max-w-[1500px] mx-auto";
}

export function Reviews({ videos = [] }: { videos?: ResenaVideo[] }) {
  const tieneVideos = videos.length > 0;
  return (
    <section id="resenas" className="py-24 lg:py-32 bg-cream/30">
      {/* Wrapper más fino que el resto del sitio en sus paddings laterales
          para que los 4 videos puedan estirarse más hacia los bordes en
          desktop sin romper la grilla del resto de la home. */}
      <div className="mx-auto px-3 sm:px-4 lg:px-8">
        <SectionTitle
          eyebrow="Reseñas"
          title="Clientes que ya elevaron su esencia"
          subtitle="Voces de quienes ya confían en nuestra curaduría."
        />
        {tieneVideos ? (
          <div className={`mt-14 grid gap-4 lg:gap-5 ${gridColsFor(videos.length)}`}>
            {videos.map((v) => (
              <figure
                key={v.id}
                className="bg-black border border-border/60 shadow-soft hover:shadow-elegant transition-elegant overflow-hidden"
              >
                {/* Card = solo el video, sin caption blanca debajo. */}
                <div className="relative aspect-[9/16] bg-black">
                  <video
                    src={v.video_url}
                    poster={v.poster_url ?? undefined}
                    controls
                    preload="metadata"
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                </div>
              </figure>
            ))}
          </div>
        ) : (
          <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto px-3 lg:px-2">
            {fallbackTextos.map((r) => (
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
        )}
      </div>
    </section>
  );
}

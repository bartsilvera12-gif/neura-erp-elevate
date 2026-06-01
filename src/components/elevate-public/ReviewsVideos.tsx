"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import type { ResenaVideo } from "./Reviews";

/**
 * Carrusel de videos de reseñas. Cada video se reproduce solo, en loop y
 * silenciado (requisito del navegador para autoplay). Se agrega:
 *  - Un botón de sonido por video para activar/desactivar el audio. Solo un
 *    video puede tener sonido a la vez (no se superponen audios).
 *  - Flechas en los extremos para desplazar el carrusel (clave en mobile,
 *    donde los videos se ven de a uno y se hace scroll horizontal con snap).
 */
export function ReviewsVideos({ videos }: { videos: ResenaVideo[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [unmutedId, setUnmutedId] = useState<string | null>(null);

  const scrollByCards = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-review-card]");
    const amount = card ? card.offsetWidth + 16 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  const toggleSound = (id: string) => {
    setUnmutedId((cur) => (cur === id ? null : id));
  };

  return (
    <div className="relative mt-14">
      <button
        type="button"
        aria-label="Anterior"
        onClick={() => scrollByCards(-1)}
        className="absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 z-20 h-11 w-11 rounded-full bg-background/90 border border-border/60 text-primary shadow-soft flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-elegant"
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        aria-label="Siguiente"
        onClick={() => scrollByCards(1)}
        className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 z-20 h-11 w-11 rounded-full bg-background/90 border border-border/60 text-primary shadow-soft flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-elegant"
      >
        <ChevronRight size={22} />
      </button>

      <div
        ref={scrollerRef}
        className="reviews-scroller flex gap-4 lg:gap-5 overflow-x-auto snap-x snap-mandatory scroll-smooth px-12 sm:px-14 pb-2"
      >
        {videos.map((v) => {
          const muted = unmutedId !== v.id;
          return (
            <figure
              key={v.id}
              data-review-card
              className="snap-center shrink-0 w-[78vw] sm:w-[280px] lg:w-[300px] bg-black border border-border/60 shadow-soft overflow-hidden"
            >
              <div className="relative aspect-[9/16] bg-black">
                <video
                  src={v.video_url}
                  poster={v.poster_url ?? undefined}
                  autoPlay
                  loop
                  muted={muted}
                  playsInline
                  preload="auto"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  aria-label={muted ? "Activar sonido" : "Silenciar"}
                  onClick={() => toggleSound(v.id)}
                  className="absolute bottom-3 right-3 z-10 h-10 w-10 rounded-full bg-black/55 text-white backdrop-blur flex items-center justify-center hover:bg-black/75 transition-elegant"
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
              </div>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

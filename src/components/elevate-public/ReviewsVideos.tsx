"use client";

import { useEffect, useRef, useState } from "react";
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
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
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

  // En mobile los videos se ven de a uno (scroll-snap), estilo reels:
  //  - Solo se reproduce/suena cuando el usuario LLEGA a la sección (la sección
  //    está visible en pantalla). Mientras esté arriba en la página, todo queda
  //    pausado y en silencio: el audio nunca arranca "al inicio".
  //  - Dentro de la sección, el video centrado se reproduce; el resto pausado.
  //  - El centrado lleva sonido automático. Las políticas del navegador impiden
  //    audio sin una interacción previa, así que el PRIMER gesto (tap o swipe)
  //    lo "desbloquea"; igualmente solo suena al estar la sección en pantalla.
  // Dos observadores: uno horizontal (qué video está centrado) y otro vertical
  // (si la sección está visible en el viewport).
  // En desktop se ven varios a la vez: no auto-reproducimos con sonido ni
  // pausamos; solo silenciamos un video al salir de vista (toggle manual).
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>("[data-review-card]"),
    );

    if (!isMobile) {
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.intersectionRatio < 0.6) {
              const id = (e.target as HTMLElement).dataset.reviewId;
              setUnmutedId((cur) => (cur === id ? null : cur));
            }
          }
        },
        { root, threshold: [0.6] },
      );
      cards.forEach((c) => obs.observe(c));
      return () => obs.disconnect();
    }

    let activeId: string | null = null;
    let sectionVisible = false;
    let unlocked = false;

    // Reproduce el video centrado (pausa el resto) SOLO si la sección está en
    // pantalla. El sonido se activa solo cuando: ya hubo un gesto del usuario
    // (unlocked) Y la sección está visible. Fuera de la sección: todo pausado y
    // en silencio.
    const apply = () => {
      for (const c of cards) {
        const cid = c.dataset.reviewId;
        const vid = cid ? videoRefs.current.get(cid) : null;
        if (!vid) continue;
        if (cid === activeId && sectionVisible) vid.play().catch(() => {});
        else vid.pause();
      }
      setUnmutedId(unlocked && sectionVisible ? activeId : null);
    };

    // Observador horizontal: qué video está centrado en el carrusel.
    const cardObs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.reviewId;
          if (!id) continue;
          if (e.intersectionRatio >= 0.6) activeId = id;
          else if (activeId === id) activeId = null;
        }
        apply();
      },
      { root, threshold: [0.6] },
    );
    cards.forEach((c) => cardObs.observe(c));

    // Observador vertical (viewport): ¿el usuario llegó a la sección de videos?
    // Recién al estar visible (~40%) se reproduce/activa el sonido; al salir de
    // pantalla (scrollear más allá) se pausa y silencia todo.
    const sectionObs = new IntersectionObserver(
      ([entry]) => {
        sectionVisible = (entry?.intersectionRatio ?? 0) >= 0.4;
        apply();
      },
      { threshold: [0, 0.4] },
    );
    sectionObs.observe(root);

    // Primer gesto del usuario en cualquier parte → desbloquea el audio (lo
    // exige el navegador). No hace sonar nada por sí solo: el audio solo arranca
    // cuando además la sección está en pantalla.
    const ac = new AbortController();
    const unlock = () => {
      unlocked = true;
      apply();
      ac.abort();
    };
    for (const ev of ["pointerdown", "touchend", "keydown"] as const) {
      window.addEventListener(ev, unlock, { signal: ac.signal });
    }

    return () => {
      cardObs.disconnect();
      sectionObs.disconnect();
      ac.abort();
    };
  }, [videos]);

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
              data-review-id={v.id}
              className="snap-center shrink-0 w-[78vw] sm:w-[280px] lg:w-[300px] bg-black border border-border/60 shadow-soft overflow-hidden"
            >
              <div className="relative aspect-[9/16] bg-black">
                <video
                  ref={(el) => {
                    if (el) videoRefs.current.set(v.id, el);
                    else videoRefs.current.delete(v.id);
                  }}
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

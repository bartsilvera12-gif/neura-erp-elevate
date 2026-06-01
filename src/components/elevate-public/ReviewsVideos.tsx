"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import type { ResenaVideo } from "./Reviews";

/**
 * Carrusel de videos de reseñas. Los videos NO usan autoPlay: arrancan
 * pausados y silenciados, y solo se reproducen cuando el usuario llega a la
 * sección (ver useEffect). El mute se fija imperativamente en el ref para
 * evitar el bug de React donde un <video muted> puede arrancar CON sonido por
 * una condición de carrera (facebook/react#10389). Se agrega:
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
    const next = unmutedId === id ? null : id;
    videoRefs.current.forEach((vid, vidId) => {
      vid.muted = vidId !== next;
    });
    setUnmutedId(next);
  };

  // Audio/reproducción de las reseñas, a prueba de "sonido al entrar":
  //  - Los videos NO tienen autoPlay; arrancan pausados y muteados. Solo se
  //    reproducen cuando el usuario LLEGA a la sección (visible ~40% en el
  //    viewport). Mientras esté arriba en la página: pausado y en silencio.
  //  - En mobile, dentro de la sección se reproduce el video centrado (resto
  //    pausado) y lleva sonido automático tras el primer gesto del usuario (lo
  //    exige el navegador). Al salir de la sección: pausa y silencio.
  //  - El mute se fija imperativamente (vid.muted), no vía prop de React, para
  //    evitar la condición de carrera del autoplay.
  // En desktop se ven varios a la vez: se reproducen muteados al ver la sección
  // (toggle manual de sonido); al salir de pantalla se silencian.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    const cards = Array.from(
      root.querySelectorAll<HTMLElement>("[data-review-card]"),
    );

    let activeId: string | null = null;
    let sectionVisible = false;
    let unlocked = false;

    const apply = () => {
      for (const c of cards) {
        const cid = c.dataset.reviewId;
        const vid = cid ? videoRefs.current.get(cid) : null;
        if (!vid) continue;
        const shouldPlay =
          sectionVisible && (isMobile ? cid === activeId : true);
        if (shouldPlay) vid.play().catch(() => {});
        else vid.pause();
      }
      const audibleId = unlocked && sectionVisible ? activeId : null;
      videoRefs.current.forEach((vid, id) => {
        vid.muted = id !== audibleId;
      });
      setUnmutedId(audibleId);
    };

    // El video "activo" (con sonido) es el más centrado horizontalmente en el
    // carrusel — vale igual en mobile (un video por pantalla) que en desktop
    // (varios visibles, suena el del medio). Recalculamos en cada scroll del
    // carrusel y al cargar.
    const computeActive = () => {
      const rootRect = root.getBoundingClientRect();
      const center = rootRect.left + rootRect.width / 2;
      let best: string | null = null;
      let bestDist = Infinity;
      for (const c of cards) {
        const id = c.dataset.reviewId;
        if (!id) continue;
        const r = c.getBoundingClientRect();
        const cc = r.left + r.width / 2;
        const d = Math.abs(cc - center);
        if (d < bestDist) {
          bestDist = d;
          best = id;
        }
      }
      if (best !== activeId) {
        activeId = best;
        apply();
      }
    };
    computeActive();
    root.addEventListener("scroll", computeActive, { passive: true });

    // Vertical (viewport): ¿el usuario llegó a la sección de videos?
    const sectionObs = new IntersectionObserver(
      ([entry]) => {
        sectionVisible = (entry?.intersectionRatio ?? 0) >= 0.4;
        apply();
      },
      { threshold: [0, 0.4] },
    );
    sectionObs.observe(root);

    // Primer gesto del usuario → desbloquea el audio (requisito del navegador).
    // No suena nada por sí solo: el audio solo arranca con la sección en pantalla.
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
      root.removeEventListener("scroll", computeActive);
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
                    if (el) {
                      el.muted = true;
                      videoRefs.current.set(v.id, el);
                    } else {
                      videoRefs.current.delete(v.id);
                    }
                  }}
                  src={v.video_url}
                  poster={v.poster_url ?? undefined}
                  loop
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

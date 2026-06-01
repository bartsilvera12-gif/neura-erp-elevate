"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import type { ResenaVideo } from "./Reviews";

/**
 * Carrusel de videos de reseñas.
 *
 * Política de audio:
 *  - MOBILE/TABLET (<lg = <1024px): el video centrado se DESMUTEA solo
 *    cuando (a) la sección está visible y (b) el usuario ya hizo cualquier
 *    gesto en la página (requisito de autoplay con sonido del browser).
 *    Al cambiar de video centrado (scroll del carrusel), el audio salta al
 *    nuevo. Si el usuario toca el botón de bocina queda fijo manualmente
 *    (override) hasta que vuelva a tocarlo.
 *  - DESKTOP (≥lg): no hay auto-unmute. El usuario activa el sonido
 *    explícitamente con el botón de bocina.
 *  - El audio se manipula imperativamente sobre el HTMLVideoElement
 *    (muted + atributo HTML + volume + play) para evitar la race condition
 *    de React con `muted` (facebook/react#10389) y para que el toggle quede
 *    en el mismo callstack que el click (requisito de iOS Safari).
 *
 * Hay un único flujo (`applyAudio`) que decide quién suena. Lee de un ref
 * mutable (no React state) para evitar lecturas viejas en callbacks y NO
 * usa React como fuente de verdad — el estado React solo refleja la UI.
 */
export function ReviewsVideos({ videos }: { videos: ResenaVideo[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [unmutedId, setUnmutedId] = useState<string | null>(null);

  // Estado mutable que NO debe causar re-render. Se lee desde callbacks
  // (observers, scroll, gestos) sin riesgo de closures viejos.
  const stateRef = useRef({
    unlocked: false,
    sectionVisible: false,
    centeredId: null as string | null,
    // Si el usuario tocó el botón de bocina, este ref dice cuál fue el
    // video elegido (o null para "vuelta al modo auto / muteado"). El
    // flujo auto NUNCA pisa esta decisión.
    manualPick: null as string | null,
    manualActive: false, // true si manualPick está vigente (incl. "manual mute")
    autoEnabled: false, // true solo en mobile/tablet
  });

  const scrollByCards = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-review-card]");
    const amount = card ? card.offsetWidth + 16 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  /**
   * Decide quién debe sonar AHORA según el estado en stateRef y lo aplica
   * imperativamente. Devuelve el id activo (o null) ya reflejado en el DOM.
   * Síncrono en la parte crítica (mute / muted=false / removeAttribute /
   * volume); play() se dispara como Promise pero el revert en caso de
   * rechazo también es síncrono. Esto preserva el gesto de usuario en iOS.
   */
  const applyAudio = (): string | null => {
    const s = stateRef.current;
    let target: string | null = null;
    if (s.manualActive) {
      target = s.manualPick; // puede ser null = "manual mute"
    } else if (s.autoEnabled && s.unlocked && s.sectionVisible) {
      target = s.centeredId;
    }

    // 1) Mutear todos los demás (atributo + propiedad)
    videoRefs.current.forEach((vid, id) => {
      if (id !== target) {
        if (!vid.muted) {
          vid.muted = true;
          vid.setAttribute("muted", "");
        } else if (!vid.hasAttribute("muted")) {
          vid.setAttribute("muted", "");
        }
      }
    });

    // 2) Desmutear target (si hay)
    if (target) {
      const vid = videoRefs.current.get(target);
      if (vid) {
        vid.muted = false;
        vid.removeAttribute("muted");
        vid.volume = 1;
        vid.play().catch(() => {
          // El browser rechazó play con sonido (típicamente iOS Safari
          // cuando el gesto fue hace mucho). Revertir al estado muteado y
          // dejar que el UI muestre VolumeX para que el usuario pueda
          // intentarlo manualmente.
          vid.muted = true;
          vid.setAttribute("muted", "");
          setUnmutedId(null);
        });
      }
    }
    setUnmutedId(target);
    return target;
  };

  const handleManualToggle = (id: string) => {
    const s = stateRef.current;
    if (s.manualActive && s.manualPick === id) {
      // Tocar el mismo: vuelve al modo "manual mute". En desktop = silencio.
      // En mobile = silencio explícito (no se reactiva auto para no sorprender).
      s.manualPick = null;
      s.manualActive = true;
    } else {
      s.manualPick = id;
      s.manualActive = true;
    }
    applyAudio();
  };

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const s = stateRef.current;
    // <lg = mobile y tablet usan auto-unmute. Desktop puro queda manual.
    s.autoEnabled = window.matchMedia("(max-width: 1023.9px)").matches;

    const cards = Array.from(
      root.querySelectorAll<HTMLElement>("[data-review-card]"),
    );

    const applyPlayback = () => {
      for (const c of cards) {
        const cid = c.dataset.reviewId;
        const vid = cid ? videoRefs.current.get(cid) : null;
        if (!vid) continue;
        if (s.sectionVisible) {
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      }
    };

    // Cuál card está más centrada → ese es el "auto target" en mobile.
    const computeCentered = () => {
      const rect = root.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
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
      if (best !== s.centeredId) {
        s.centeredId = best;
        if (s.autoEnabled && !s.manualActive) applyAudio();
      }
    };
    computeCentered();
    root.addEventListener("scroll", computeCentered, { passive: true });

    const sectionObs = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = s.sectionVisible;
        s.sectionVisible = (entry?.intersectionRatio ?? 0) >= 0.1;
        applyPlayback();
        if (wasVisible !== s.sectionVisible) applyAudio();
      },
      { threshold: [0, 0.1] },
    );
    sectionObs.observe(root);

    // Primer gesto del usuario en cualquier parte de la página: habilita
    // autoplay con sonido (requisito del browser). El listener se quita
    // tras la primera vez para no consumir eventos extra.
    const ac = new AbortController();
    const unlock = () => {
      if (s.unlocked) return;
      s.unlocked = true;
      ac.abort();
      if (s.autoEnabled && !s.manualActive) applyAudio();
    };
    for (const ev of ["pointerdown", "touchend", "keydown", "click"] as const) {
      window.addEventListener(ev, unlock, { signal: ac.signal, passive: true });
    }

    return () => {
      root.removeEventListener("scroll", computeCentered);
      sectionObs.disconnect();
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                      // Estado inicial: muteado (HTML attr + propiedad JS) para
                      // habilitar autoplay legal y evitar la race condition de
                      // React con `muted` (#10389).
                      el.muted = true;
                      el.setAttribute("muted", "");
                      videoRefs.current.set(v.id, el);
                    } else {
                      videoRefs.current.delete(v.id);
                    }
                  }}
                  src={v.video_url}
                  poster={v.poster_url ?? undefined}
                  loop
                  playsInline
                  muted
                  preload="auto"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  aria-label={muted ? "Activar sonido" : "Silenciar"}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleManualToggle(v.id);
                  }}
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

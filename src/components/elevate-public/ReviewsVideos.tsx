"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import type { ResenaVideo } from "./Reviews";

/**
 * Carrusel de videos de reseñas con AUDIO 100% MANUAL.
 *
 * Diseño:
 *  - Cada video arranca muteado (HTML attr + propiedad JS) y entra en
 *    autoplay-muted cuando la sección aparece en el viewport — eso lo
 *    permite la política de autoplay del browser sin gesto del usuario.
 *  - El sonido NO se activa solo. Sólo se enciende cuando el usuario
 *    clickea o toca el video (o el botón de bocina). Esto cumple con la
 *    política "user gesture required for audio playback" en Chrome,
 *    Safari iOS y Firefox.
 *  - Solo un video puede tener sonido a la vez. Al desmutear uno, todos
 *    los demás se mutean.
 *  - El audio se manipula imperativamente sobre el HTMLVideoElement
 *    (no via prop de React) para evitar la condición de carrera de React
 *    con `muted` (facebook/react#10389) y para mantener atributo HTML +
 *    propiedad JS sincronizados, lo que algunos browsers exigen.
 *  - Se usa `await play()` para detectar si el browser rechazó la
 *    transición a audio (caso raro pero posible); en ese caso revertimos
 *    al estado muteado en vez de quedar con UI inconsistente.
 *
 * El play/pause según visibilidad y el control de audio son flujos
 * INDEPENDIENTES — el observer NUNCA toca `muted` ni `unmutedId`, sólo
 * play() y pause(). Esto elimina la race condition con el toggle manual.
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

  /**
   * Toggle de audio. Operación imperativa sobre el <video> real.
   * Si está muteado → activa. Si está sonando → mutea.
   * Protocolo completo: muted=false + removeAttribute('muted') + volume=1
   * + await play(); con fallback a muteado si el browser rechaza.
   */
  const toggleSound = async (id: string) => {
    const wasOn = unmutedId === id;

    // 1) Mutear todos los demás (HTML attr + propiedad JS). Siempre se
    //    hace, garantiza que nunca queden dos pistas sonando juntas.
    videoRefs.current.forEach((vid, vidId) => {
      if (vidId !== id) {
        vid.muted = true;
        vid.setAttribute("muted", "");
      }
    });

    const target = videoRefs.current.get(id);
    if (!target) {
      setUnmutedId(wasOn ? null : id);
      return;
    }

    if (wasOn) {
      // Re-mutear el target (toggle off)
      target.muted = true;
      target.setAttribute("muted", "");
      setUnmutedId(null);
      return;
    }

    // Activar audio en target
    target.muted = false;
    target.removeAttribute("muted");
    target.volume = 1;
    try {
      // El click/tap que dispara este handler es el "user gesture" que
      // habilita la reproducción con audio. await detecta si el browser
      // igual la rechaza (autoplay policy no satisfecha en algún edge case).
      await target.play();
      setUnmutedId(id);
    } catch {
      // Fallback: volver a muteado para no quedar con UI mintiendo.
      target.muted = true;
      target.setAttribute("muted", "");
      setUnmutedId(null);
    }
  };

  // Play/pause según visibilidad de la sección. NO toca audio.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;

    const cards = Array.from(
      root.querySelectorAll<HTMLElement>("[data-review-card]"),
    );
    let sectionVisible = false;

    const applyPlayback = () => {
      for (const c of cards) {
        const cid = c.dataset.reviewId;
        const vid = cid ? videoRefs.current.get(cid) : null;
        if (!vid) continue;
        if (sectionVisible) {
          // autoplay-muted siempre permitido por política del browser.
          vid.play().catch(() => {});
        } else {
          vid.pause();
        }
      }
    };

    const sectionObs = new IntersectionObserver(
      ([entry]) => {
        sectionVisible = (entry?.intersectionRatio ?? 0) >= 0.1;
        applyPlayback();
      },
      { threshold: [0, 0.1] },
    );
    sectionObs.observe(root);

    return () => sectionObs.disconnect();
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
                      // Estado inicial garantizado: muteado en JS y en HTML
                      // para que el autoplay sea legal y para evitar la
                      // race condition de React con `muted` (#10389).
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
                  onClick={() => toggleSound(v.id)}
                  className="h-full w-full object-cover cursor-pointer"
                />
                {/* Hint visible mientras está muteado: deja claro que el
                    video es interactivo (patrón TikTok/IG). pointer-events-none
                    para que el click pase al <video>. */}
                {muted && (
                  <div
                    className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none"
                    aria-hidden="true"
                  >
                    <span className="bg-black/45 text-white text-[11px] tracking-[0.25em] uppercase px-3 py-1.5 backdrop-blur-sm">
                      Tocá para sonido
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={muted ? "Activar sonido" : "Silenciar"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSound(v.id);
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

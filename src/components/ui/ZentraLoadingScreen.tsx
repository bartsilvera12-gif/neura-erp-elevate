"use client";

/**
 * Pantalla de carga global de Zentra.
 *
 * - Logo Zentra (SVG inline) con zoom suave constante.
 * - Texto "Cargando" con efecto ola por letra (delay escalonado).
 * - Respeta `prefers-reduced-motion`.
 * - `fullScreen` (default true) usa fixed overlay; si false, ocupa el
 *   contenedor donde se monte (útil para slots de Suspense).
 */
export function ZentraLoadingScreen({
  fullScreen = true,
  label = "Cargando",
}: {
  fullScreen?: boolean;
  label?: string;
}) {
  const containerClass = fullScreen
    ? "fixed inset-0 z-[9999] flex items-center justify-center"
    : "flex min-h-[40vh] w-full items-center justify-center py-16";

  return (
    <div
      className={containerClass}
      style={{
        background:
          "radial-gradient(circle at center, #1e3a8a 0%, #0f1e4d 60%, #07112b 100%)",
        color: "#ffffff",
      }}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex flex-col items-center gap-6">
        <ZentraLogo />
        <div className="flex select-none gap-[2px] text-sm tracking-[0.45em] uppercase text-white/85">
          {Array.from(label).map((ch, i) => (
            <span
              key={`${ch}-${i}`}
              className="zentra-loading-letter inline-block"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              {ch === " " ? " " : ch}
            </span>
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes zentra-logo-pulse {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 0 rgba(255, 255, 255, 0));
          }
          50% {
            transform: scale(1.04);
            filter: drop-shadow(0 0 18px rgba(255, 255, 255, 0.25));
          }
        }
        @keyframes zentra-letter-wave {
          0%, 100% {
            transform: translateY(0) scale(1);
            opacity: 0.55;
          }
          50% {
            transform: translateY(-3px) scale(1.08);
            opacity: 1;
          }
        }
        :global(.zentra-loading-logo) {
          animation: zentra-logo-pulse 2.2s ease-in-out infinite;
          transform-origin: center;
          will-change: transform, filter;
        }
        :global(.zentra-loading-letter) {
          animation: zentra-letter-wave 1.6s ease-in-out infinite;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.zentra-loading-logo),
          :global(.zentra-loading-letter) {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
            filter: none !important;
          }
        }
      `}</style>
    </div>
  );
}

function ZentraLogo() {
  // SVG inline del isotipo Z (dos triángulos cruzados) + wordmark debajo.
  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        viewBox="0 0 120 120"
        className="zentra-loading-logo h-20 w-20 sm:h-24 sm:w-24"
        fill="currentColor"
        aria-hidden="true"
      >
        {/* Triángulo superior izquierdo */}
        <polygon points="15,15 90,15 90,40 35,40" />
        {/* Barra diagonal */}
        <polygon points="35,40 90,40 85,80 30,80" />
        {/* Triángulo inferior derecho */}
        <polygon points="30,80 105,80 105,105 30,105" />
      </svg>
      <span className="text-xl font-extrabold tracking-[0.4em] sm:text-2xl">
        ZENTRA
      </span>
    </div>
  );
}

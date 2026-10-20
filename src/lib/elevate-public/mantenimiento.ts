/**
 * Web pública en mantenimiento (perfumeriaelevate.com y demás hosts de ELEVATE_PUBLIC_WEB_HOSTS).
 *
 * Con `true`, el middleware contesta todas las páginas de los hosts públicos con el aviso de
 * mantenimiento (503 + Retry-After, que es lo que Google espera para no desindexar el sitio).
 * Las imágenes y /_next siguen sirviéndose para que el aviso muestre el logo.
 * No afecta al ERP (elevate.neura.com.py), que tiene su propio flag en src/lib/bloqueo-pago.ts.
 *
 * PARA VOLVER A ABRIR LA WEB: poner `false`, commit + push a main y esperar el redeploy de Coolify.
 */
export const WEB_PUBLICA_EN_MANTENIMIENTO = true;

export const MANTENIMIENTO_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Elevate · Sitio en mantenimiento</title>
<link rel="icon" href="/favicon.ico" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center;
    min-height: 100dvh; padding: 24px 16px;
    background: linear-gradient(135deg, hsl(346 96% 19%) 0%, hsl(346 80% 12%) 100%);
    color: hsl(48 55% 97%);
    font-family: Georgia, "Times New Roman", serif;
    text-align: center;
  }
  main { max-width: 440px; }
  img { width: 180px; max-width: 60vw; height: auto; margin: 0 auto 32px; display: block; }
  h1 { font-size: 26px; font-weight: normal; letter-spacing: 0.04em; margin-bottom: 14px; }
  p { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 15px; line-height: 1.6; opacity: 0.85; }
  .line { width: 48px; height: 1px; background: hsl(43 60% 60%); margin: 0 auto 20px; }
</style>
</head>
<body>
<main>
  <img src="/brand/elevate/elevate-logo-gold.png" alt="Elevate" />
  <div class="line"></div>
  <h1>Sitio en mantenimiento</h1>
  <p>Estamos realizando mejoras en nuestra tienda online. Volvemos a estar disponibles muy pronto.</p>
  <p style="margin-top: 12px">Gracias por tu paciencia.</p>
</main>
</body>
</html>`;

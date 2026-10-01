import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import AppShell from "../components/AppShell";
import { ThemeProvider } from "../components/ThemeProvider";
import AuthGuard from "../components/AuthGuard";
import { ELEVATE_PUBLIC_HEADER } from "../lib/elevate-public/hosts";
import "./globals.css";

/**
 * Fuentes locales, no `next/font/google`: con Google, `next build` descarga las fuentes en medio
 * del build y, si esa descarga se corta (build server cargado, red), aborta el deploy entero
 * ("Failed to fetch `Plus Jakarta Sans` from Google Fonts"). Son los mismos archivos que Google
 * entregaba (subset latino, fuentes variables: un archivo cubre todos los pesos). Licencia OFL.
 */
const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-plus-jakarta",
  weight: "300 800",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Neura ERP",
  description: "Sistema de gestión empresarial de Neura",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", type: "image/png" }],
  },
};

/**
 * Root layout. Decide en server-time si la request corresponde a la web
 * pública de Elevate (header inyectado por el middleware) o al ERP/admin.
 *
 *   - Web pública  → children directo (chrome propio en `__public/layout.tsx`).
 *   - ERP/admin    → `AuthGuard` + `AppShell` (sidebar + topbar) como antes.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = await headers();
  const isPublic = h.get(ELEVATE_PUBLIC_HEADER) === "1";

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          {isPublic ? (
            children
          ) : (
            <AuthGuard>
              <AppShell>{children}</AppShell>
            </AuthGuard>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}

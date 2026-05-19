import type { Metadata } from "next";
import { Playfair_Display, Cormorant_Garamond, Inter } from "next/font/google";
import { Header } from "@/components/elevate-public/Header";
import { Footer } from "@/components/elevate-public/Footer";
import "./elevate-theme.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Elevate · Maison de Parfum",
  description: "Elevate: perfumería premium con fragancias nicho, ultranicho, de diseñador y árabes originales.",
};

/**
 * Layout de la web pública Elevate. Scopea fonts y theme tokens vía
 * `.elevate-public-theme` para no afectar al ERP. Header es fixed (h-28);
 * cada page agrega el padding-top apropiado o lo absorbe (Hero usa min-h-screen).
 */
export default function ElevatePublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`elevate-public-theme min-h-svh flex flex-col ${playfair.variable} ${cormorant.variable} ${inter.variable}`}
    >
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

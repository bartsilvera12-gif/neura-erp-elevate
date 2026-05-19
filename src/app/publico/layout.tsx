import type { Metadata } from "next";
import ElevatePublicHeader from "@/components/ElevatePublicHeader";
import ElevatePublicFooter from "@/components/ElevatePublicFooter";

export const metadata: Metadata = {
  title: "Elevate",
  description: "Perfumería boutique Elevate.",
};

/**
 * Layout de la web pública (`/__public/...` interno; URL visible sin prefijo
 * gracias al rewrite del middleware).
 */
export default function ElevatePublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-white text-neutral-900">
      <ElevatePublicHeader />
      <main className="flex-1">{children}</main>
      <ElevatePublicFooter />
    </div>
  );
}

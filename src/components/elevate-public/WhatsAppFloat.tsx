"use client";

import { MessageCircle } from "lucide-react";
import {
  buildGenericWhatsappLink,
  getElevateWhatsappNumber,
} from "@/lib/elevate-public/whatsapp";

/**
 * Botón flotante WhatsApp (consulta genérica). Si no hay
 * NEXT_PUBLIC_ELEVATE_WHATSAPP_NUMBER configurado, no se renderiza —
 * preferimos invisible a un link roto.
 */
export function WhatsAppFloat() {
  const number = getElevateWhatsappNumber();
  const href = buildGenericWhatsappLink(number);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Consultar por WhatsApp"
      className="fixed bottom-6 right-6 z-40 group"
    >
      <div className="absolute inset-0 bg-gold/40 rounded-full animate-ping opacity-50" />
      <div className="relative bg-gold text-gold-foreground h-14 w-14 rounded-full flex items-center justify-center shadow-gold hover:bg-primary hover:text-primary-foreground transition-elegant">
        <MessageCircle size={24} />
      </div>
      <span className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-primary text-cream text-xs tracking-widest uppercase px-4 py-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-elegant pointer-events-none">
        Consultar
      </span>
    </a>
  );
}

import Link from "next/link";
import { ChevronRight, Lock, Database, Share2, Cookie, UserCheck, Mail } from "lucide-react";

export const metadata = {
  title: "Política de privacidad · Elevate",
  description:
    "Cómo Elevate recolecta, usa y protege los datos personales de sus clientes.",
};

export default function PoliticaPrivacidadPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative bg-primary text-cream pt-24 pb-12 sm:pt-36 sm:pb-24 lg:pt-44 lg:pb-32">
        <div className="absolute inset-0 bg-gradient-to-b from-primary via-primary to-primary/95" />
        <div className="relative container mx-auto px-6 lg:px-10">
          <nav className="mb-6 sm:mb-8 text-xs tracking-[0.25em] uppercase text-cream/60">
            <Link href="/" className="hover:text-gold-light transition-smooth">
              Inicio
            </Link>
            <ChevronRight size={12} className="inline mx-2 -mt-0.5" />
            <span className="text-cream/90">Política de privacidad</span>
          </nav>

          <span className="inline-block text-gold-light text-xs tracking-[0.4em] uppercase mb-4 sm:mb-6">
            Tu información, tu confianza
          </span>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl text-cream leading-[0.95] text-balance">
            Política de privacidad
          </h1>
          <div className="gold-divider w-24 sm:w-32 my-5 sm:my-8" />
          <p className="font-editorial italic text-lg sm:text-xl md:text-2xl text-cream/85 max-w-2xl leading-relaxed">
            Cómo cuidamos tus datos personales y la información que compartís con
            nosotros al realizar una compra.
          </p>
        </div>
      </section>

      {/* Contenido */}
      <section className="bg-background py-12 sm:py-20 lg:py-28">
        <div className="container mx-auto px-6 lg:px-10">
          <div className="max-w-3xl mx-auto">
            {/* Bloque destacado */}
            <div className="border border-gold/40 bg-cream/40 p-5 sm:p-8 lg:p-10 mb-8 sm:mb-12">
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center border border-gold/60 text-gold">
                  <Lock size={20} strokeWidth={1.5} />
                </div>
                <div>
                  <h2 className="font-display text-xl sm:text-2xl md:text-3xl text-primary leading-tight">
                    Tus datos son tratados con confidencialidad
                  </h2>
                  <div className="gold-divider w-12 sm:w-16 my-3 sm:my-4" />
                  <p className="text-foreground/80 leading-relaxed text-sm sm:text-base md:text-lg">
                    Toda la información personal que recibimos durante el proceso
                    de compra se utiliza exclusivamente para gestionar tu pedido
                    y mejorar tu experiencia con Elevate. No vendemos ni cedemos
                    tus datos a terceros con fines comerciales.
                  </p>
                </div>
              </div>
            </div>

            {/* Bloques temáticos */}
            <div className="space-y-6 sm:space-y-10">
              <PolicyBlock
                icon={<Database size={20} strokeWidth={1.5} />}
                title="Qué datos recolectamos"
              >
                Nombre, email, teléfono y dirección de envío al momento de
                completar tu pedido. No almacenamos datos sensibles de tarjetas
                de crédito: los pagos se procesan a través de pasarelas seguras
                externas.
              </PolicyBlock>

              <PolicyBlock
                icon={<Share2 size={20} strokeWidth={1.5} />}
                title="Cómo los usamos"
              >
                Para confirmar tu pedido, coordinar el envío, emitir comprobantes
                y mantenerte al tanto del estado de tu compra. Eventualmente
                podemos enviarte novedades por WhatsApp o email, siempre con
                opción a darte de baja.
              </PolicyBlock>

              <PolicyBlock
                icon={<UserCheck size={20} strokeWidth={1.5} />}
                title="Con quién los compartimos"
              >
                Solo con la transportadora encargada del envío de tu pedido y
                con la pasarela de pago elegida. Ningún tercero recibe
                información tuya con fines de marketing.
              </PolicyBlock>

              <PolicyBlock
                icon={<Cookie size={20} strokeWidth={1.5} />}
                title="Cookies y analítica"
              >
                Usamos cookies básicas de sesión y herramientas de analítica
                anónimas (estadísticas de uso del sitio). No usamos cookies de
                seguimiento publicitario de terceros.
              </PolicyBlock>

              <PolicyBlock
                icon={<Mail size={20} strokeWidth={1.5} />}
                title="Tus derechos"
              >
                Podés solicitar en cualquier momento ver, modificar o eliminar
                los datos personales que tenemos sobre vos. Para hacerlo,
                escribinos a{" "}
                <a
                  href="mailto:elevategroup023@gmail.com"
                  className="text-gold hover:text-primary transition-smooth"
                >
                  elevategroup023@gmail.com
                </a>{" "}
                y respondemos en un plazo máximo de 48 hs.
              </PolicyBlock>
            </div>

            {/* Cierre */}
            <div className="mt-10 sm:mt-16 pt-8 sm:pt-10 border-t border-border text-center">
              <p className="font-editorial italic text-base sm:text-lg text-muted-foreground">
                ¿Alguna duda sobre el tratamiento de tus datos?
              </p>
              <Link
                href="/faq"
                className="inline-block mt-4 sm:mt-5 px-8 py-3 border border-gold/60 text-primary text-xs tracking-[0.3em] uppercase hover:bg-gold/10 transition-elegant"
              >
                Ver preguntas frecuentes
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function PolicyBlock({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 sm:gap-5 lg:gap-7">
      <div className="shrink-0 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center border border-border text-gold">
        {icon}
      </div>
      <div className="flex-1 pt-1">
        <h3 className="font-display text-lg sm:text-xl md:text-2xl text-primary">{title}</h3>
        <p className="mt-2 sm:mt-3 text-foreground/80 leading-relaxed text-sm sm:text-base">
          {children}
        </p>
      </div>
    </div>
  );
}

/**
 * GET /api/public/elevate/productos
 *
 * Listado público del catálogo Elevate (sin auth). Fase 1 catálogo enriquecido:
 * incluye precio_oferta vigente, nuevo_hasta, concentración, volumen, género,
 * familia olfativa, y derivaciones de status_label / is_new / promo_label.
 *
 * Seguridad:
 *  - Whitelist estricta. Nunca `select=*`.
 *  - NO se exponen costo_promedio, proveedor_principal_id, stock_actual numérico,
 *    ni cualquier otro dato interno.
 *  - stock_actual sólo se consulta para derivar booleanos/labels; nunca se
 *    devuelve al cliente.
 *  - Filtros forzados: activo=true AND visible_web=true.
 *  - CORS controlado por ELEVATE_PUBLIC_WEB_ORIGIN.
 *
 * Query params:
 *   ?limit=20        1..100 (default 20)
 *   ?page=1          >=1 (default 1)
 *   ?destacado=true  solo destacados
 *   ?nuevos=true     solo isNew (nuevo_hasta >= hoy)
 *   ?promos=true     solo con oferta vigente
 */
import { NextRequest, NextResponse } from "next/server";
import { elevatePublicCorsHeaders, PUBLIC_CATALOG_CACHE } from "@/lib/public-api/cors";
import { postgrestGet } from "@/lib/elevate-public/catalog-postgrest";
import { publicProductoImagenUrl } from "@/lib/inventario/imagen-storage";

export const dynamic = "force-dynamic";

/**
 * Columnas crudas pedidas a PostgREST. stock_actual + stock_minimo +
 * proximamente quedan SOLO en server-side; se eliminan antes de responder.
 */
const PUBLIC_SELECT =
  "id," +
  "slug:slug_web," +
  "nombre," +
  "marca," +
  "precio_web," +
  "precio_venta," +
  "precio_oferta," +
  "oferta_hasta," +
  "nuevo_hasta," +
  "imagen_url," +
  "imagen_path," +
  "descripcion_corta," +
  "destacado:destacado_web," +
  "stock_actual," +
  "stock_minimo," +
  "proximamente," +
  "concentracion," +
  "volumen_ml," +
  "genero," +
  "orden_web," +
  "familia:familias_olfativas(nombre)";

type FamiliaRef = { nombre: string | null } | null;

type ProductoRaw = {
  id: string;
  slug: string | null;
  nombre: string | null;
  marca: string | null;
  precio_web: number | null;
  precio_venta: number | null;
  precio_oferta: number | null;
  oferta_hasta: string | null;
  nuevo_hasta: string | null;
  imagen_url: string | null;
  imagen_path: string | null;
  descripcion_corta: string | null;
  destacado: boolean | null;
  stock_actual: number | null;
  stock_minimo: number | null;
  proximamente: boolean | null;
  concentracion: string | null;
  volumen_ml: number | null;
  genero: string | null;
  orden_web: number | null;
  familia: FamiliaRef;
};

export type ProductoPublico = {
  id: string;
  slug: string | null;
  nombre: string | null;
  marca: string | null;
  precio: number;
  precio_anterior: number | null;
  precio_oferta: number | null;
  oferta_hasta: string | null;
  imagen_url: string | null;
  descripcion_corta: string | null;
  destacado: boolean;
  disponible: boolean;
  is_new: boolean;
  promo_label: string | null;
  status_label: "Disponible" | "Últimas unidades" | "Sin stock" | "Próximamente";
  concentracion: string | null;
  volumen_ml: number | null;
  genero: string | null;
  familia_olfativa: string | null;
  orden_web: number | null;
};

function isOfertaActiva(precio_oferta: number | null, oferta_hasta: string | null): boolean {
  if (precio_oferta == null) return false;
  if (!oferta_hasta) return true;
  const t = Date.parse(oferta_hasta);
  if (Number.isNaN(t)) return true;
  return t > Date.now();
}

function isNuevo(nuevo_hasta: string | null): boolean {
  if (!nuevo_hasta) return false;
  // nuevo_hasta es date; comparar lex (YYYY-MM-DD) contra hoy local UTC suficiente
  const today = new Date().toISOString().slice(0, 10);
  return nuevo_hasta >= today;
}

export function toPublico(r: ProductoRaw): ProductoPublico {
  // Regla Elevate: precio base = precio_venta (precio_web queda como legacy,
  // no se usa para el precio normal mostrado en la web).
  const precioBase =
    typeof r.precio_venta === "number" && Number.isFinite(r.precio_venta)
      ? r.precio_venta
      : typeof r.precio_web === "number" && Number.isFinite(r.precio_web)
      ? r.precio_web
      : 0;
  const ofertaActiva = isOfertaActiva(r.precio_oferta, r.oferta_hasta);
  const precio = ofertaActiva ? (r.precio_oferta as number) : precioBase;
  const precio_anterior = ofertaActiva ? precioBase : null;

  const stock = typeof r.stock_actual === "number" ? r.stock_actual : 0;
  const stockMin = typeof r.stock_minimo === "number" ? r.stock_minimo : 0;
  const proximamente = r.proximamente === true;
  const disponible = stock > 0 && !proximamente;
  const ultimasUnidades = !proximamente && stock > 0 && stock <= stockMin;

  let status_label: ProductoPublico["status_label"];
  if (proximamente) status_label = "Próximamente";
  else if (stock <= 0) status_label = "Sin stock";
  else if (ultimasUnidades) status_label = "Últimas unidades";
  else status_label = "Disponible";

  let promo_label: string | null = null;
  if (ofertaActiva) promo_label = "Promo especial";
  else if (ultimasUnidades) promo_label = "Últimas unidades";

  return {
    id: r.id,
    slug: r.slug,
    nombre: r.nombre,
    marca: r.marca,
    precio,
    precio_anterior,
    precio_oferta: ofertaActiva ? r.precio_oferta : null,
    oferta_hasta: ofertaActiva ? r.oferta_hasta : null,
    imagen_url: r.imagen_url ?? publicProductoImagenUrl(r.imagen_path),
    descripcion_corta: r.descripcion_corta,
    destacado: r.destacado === true,
    disponible,
    is_new: isNuevo(r.nuevo_hasta),
    promo_label,
    status_label,
    concentracion: r.concentracion,
    volumen_ml: r.volumen_ml,
    genero: r.genero,
    familia_olfativa: r.familia?.nombre ?? null,
    orden_web: r.orden_web,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: elevatePublicCorsHeaders() });
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const pageRaw = parseInt(url.searchParams.get("page") ?? "1", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
    const offset = (page - 1) * limit;
    const destacadoOnly = url.searchParams.get("destacado") === "true";
    const nuevosOnly = url.searchParams.get("nuevos") === "true";
    const promosOnly = url.searchParams.get("promos") === "true";

    const qs = new URLSearchParams({
      select: PUBLIC_SELECT,
      activo: "eq.true",
      visible_web: "eq.true",
      order: "orden_web.asc.nullslast,destacado_web.desc,nombre.asc",
      limit: String(limit),
      offset: String(offset),
    });
    if (destacadoOnly) qs.set("destacado_web", "eq.true");
    if (nuevosOnly) qs.set("nuevo_hasta", `gte.${new Date().toISOString().slice(0, 10)}`);
    if (promosOnly) qs.set("precio_oferta", "not.is.null");

    const result = await postgrestGet<ProductoRaw>("productos", qs.toString());
    if (!result.ok) {
      console.error("[/api/public/elevate/productos GET]", result.error);
      return NextResponse.json(
        { error: "No se pudieron cargar los productos." },
        { status: 502, headers: elevatePublicCorsHeaders() }
      );
    }
    const productos = result.rows.map(toPublico);

    return NextResponse.json(
      { productos, page, limit, count: productos.length },
      {
        status: 200,
        headers: { ...PUBLIC_CATALOG_CACHE, ...elevatePublicCorsHeaders() },
      }
    );
  } catch (err) {
    console.error(
      "[/api/public/elevate/productos GET] uncaught",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "No se pudieron cargar los productos." },
      { status: 500, headers: elevatePublicCorsHeaders() }
    );
  }
}

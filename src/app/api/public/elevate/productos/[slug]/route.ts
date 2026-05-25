/**
 * GET /api/public/elevate/productos/[slug]
 *
 * Detalle público del producto. Incluye descripción larga, concentración,
 * volumen, género, familia olfativa, pirámide de notas (top/heart/base),
 * y derivaciones de precio/promo/status.
 */
import { NextRequest, NextResponse } from "next/server";
import { elevatePublicCorsHeaders, PUBLIC_CATALOG_CACHE } from "@/lib/public-api/cors";
import { postgrestGet } from "@/lib/elevate-public/catalog-postgrest";

// Sin `force-dynamic`: respeta el Cache-Control público
// (`public, s-maxage=300, stale-while-revalidate=120`). Filtros activo +
// visible_web + slug_web previenen exposición de productos privados.

// NOTA: NO incluir `sku` aquí. El rol `anon` de PostgREST tiene column-level
// GRANT SELECT en casi todas las columnas de elevate.productos EXCEPTO `sku`
// (decisión histórica: SKU = identificador interno). Si se pide via PostgREST
// con `select=...,sku,...`, devuelve 403 "permission denied for table
// familias_olfativas" (mensaje engañoso pero la causa real es el sku sin
// grant para anon). Si más adelante se quiere exponer SKU al público hace
// falta autorizar una migración: `GRANT SELECT (sku) ON elevate.productos
// TO anon;`. Por ahora el WhatsApp message del botón "Consultar" usa solo
// nombre + URL del producto cuando sku viene null/undefined.
const PUBLIC_DETAIL_SELECT =
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
  "descripcion_corta," +
  "descripcion_web," +
  "destacado:destacado_web," +
  "stock_actual," +
  "stock_minimo," +
  "proximamente," +
  "concentracion," +
  "volumen_ml," +
  "genero," +
  "orden_web," +
  "familia:familias_olfativas(nombre,descripcion)," +
  "categoria:categoria_principal_id(nombre,slug_web,visible_web,activo)," +
  "notas:producto_notas(posicion,orden,nota:notas_olfativas(nombre))";

type FamiliaRef = { nombre: string | null; descripcion: string | null } | null;
type CategoriaRef = {
  nombre: string | null;
  slug_web: string | null;
  visible_web: boolean | null;
  activo: boolean | null;
} | null;
type NotaRow = {
  posicion: "top" | "heart" | "base";
  orden: number | null;
  nota: { nombre: string | null } | null;
};

type ProductoDetalleRaw = {
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
  descripcion_corta: string | null;
  descripcion_web: string | null;
  destacado: boolean | null;
  stock_actual: number | null;
  stock_minimo: number | null;
  proximamente: boolean | null;
  concentracion: string | null;
  volumen_ml: number | null;
  genero: string | null;
  orden_web: number | null;
  familia: FamiliaRef;
  categoria: CategoriaRef;
  notas: NotaRow[] | null;
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
  return nuevo_hasta >= new Date().toISOString().slice(0, 10);
}

function pickNotas(rows: NotaRow[] | null, pos: "top" | "heart" | "base"): string[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((n) => n && n.posicion === pos && n.nota?.nombre)
    .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999))
    .map((n) => n.nota!.nombre as string);
}

function toDetalle(r: ProductoDetalleRaw) {
  // Regla Elevate: precio base = precio_venta (precio_web legacy, no
  // se prioriza).
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

  let status_label: "Disponible" | "Últimas unidades" | "Sin stock" | "Próximamente";
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
    imagen_url: r.imagen_url,
    descripcion_corta: r.descripcion_corta,
    descripcion_web: r.descripcion_web,
    destacado: r.destacado === true,
    disponible,
    is_new: isNuevo(r.nuevo_hasta),
    promo_label,
    status_label,
    concentracion: r.concentracion,
    volumen_ml: r.volumen_ml,
    genero: r.genero,
    familia_olfativa: r.familia?.nombre ?? null,
    categoria_nombre:
      r.categoria && r.categoria.visible_web !== false && r.categoria.activo !== false
        ? r.categoria.nombre ?? null
        : null,
    categoria_slug:
      r.categoria && r.categoria.visible_web !== false && r.categoria.activo !== false
        ? r.categoria.slug_web ?? null
        : null,
    notas_top: pickNotas(r.notas, "top"),
    notas_heart: pickNotas(r.notas, "heart"),
    notas_base: pickNotas(r.notas, "base"),
    orden_web: r.orden_web,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: elevatePublicCorsHeaders() });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const cleanSlug = (slug ?? "").trim();
    if (!cleanSlug || cleanSlug.length > 200) {
      return NextResponse.json(
        { error: "Slug inválido" },
        { status: 400, headers: elevatePublicCorsHeaders() }
      );
    }

    const qs = new URLSearchParams({
      select: PUBLIC_DETAIL_SELECT,
      activo: "eq.true",
      visible_web: "eq.true",
      slug_web: `eq.${cleanSlug}`,
      limit: "1",
    });

    const result = await postgrestGet<ProductoDetalleRaw>("productos", qs.toString());
    if (!result.ok) {
      console.error("[/api/public/elevate/productos/[slug] GET]", result.error);
      return NextResponse.json(
        { error: "No se pudo cargar el producto." },
        { status: 502, headers: elevatePublicCorsHeaders() }
      );
    }
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404, headers: elevatePublicCorsHeaders() }
      );
    }
    return NextResponse.json(
      { producto: toDetalle(result.rows[0]) },
      {
        status: 200,
        headers: { ...PUBLIC_CATALOG_CACHE, ...elevatePublicCorsHeaders() },
      }
    );
  } catch (err) {
    console.error(
      "[/api/public/elevate/productos/[slug] GET] uncaught",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "No se pudo cargar el producto." },
      { status: 500, headers: elevatePublicCorsHeaders() }
    );
  }
}

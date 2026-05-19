/**
 * GET /api/public/elevate/productos/[slug]
 *
 * Detalle público de producto por slug_web. Mismas garantías de seguridad
 * que el listado: whitelist estricta de columnas, sin costo/proveedor/stock
 * interno, filtra activo=true AND visible_web=true.
 *
 * Transporte: PostgREST HTTPS (sin pool PG directo, sin SUPABASE_DB_URL).
 */
import { NextRequest, NextResponse } from "next/server";
import { elevatePublicCorsHeaders, PUBLIC_CATALOG_CACHE } from "@/lib/public-api/cors";
import { postgrestGet } from "@/lib/elevate-public/catalog-postgrest";

export const dynamic = "force-dynamic";

const PUBLIC_DETAIL_SELECT =
  "id," +
  "slug:slug_web," +
  "nombre," +
  "marca," +
  "precio_web," +
  "precio_venta," +
  "imagen_url," +
  "descripcion_corta," +
  "descripcion_web," +
  "destacado:destacado_web," +
  "stock_actual";

type ProductoDetalleRaw = {
  id: string;
  slug: string | null;
  nombre: string | null;
  marca: string | null;
  precio_web: number | null;
  precio_venta: number | null;
  imagen_url: string | null;
  descripcion_corta: string | null;
  descripcion_web: string | null;
  destacado: boolean | null;
  stock_actual: number | null;
};

function toDetalle(r: ProductoDetalleRaw) {
  const precio =
    typeof r.precio_web === "number" && Number.isFinite(r.precio_web)
      ? r.precio_web
      : typeof r.precio_venta === "number" && Number.isFinite(r.precio_venta)
      ? r.precio_venta
      : 0;
  return {
    id: r.id,
    slug: r.slug,
    nombre: r.nombre,
    marca: r.marca,
    precio,
    imagen_url: r.imagen_url,
    descripcion_corta: r.descripcion_corta,
    descripcion_web: r.descripcion_web,
    destacado: r.destacado === true,
    disponible: typeof r.stock_actual === "number" && r.stock_actual > 0,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: elevatePublicCorsHeaders(),
  });
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
        headers: {
          ...PUBLIC_CATALOG_CACHE,
          ...elevatePublicCorsHeaders(),
        },
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

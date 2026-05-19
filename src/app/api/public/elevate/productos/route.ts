/**
 * GET /api/public/elevate/productos
 *
 * Endpoint público del catálogo (sin auth). Diseñado para que la web pública
 * de Elevate consuma productos publicados (visible_web=true AND activo=true).
 *
 * Seguridad:
 *  - Whitelist estricta de columnas: NUNCA SELECT *. La lista se materializa
 *    en `PUBLIC_SELECT` y se envía a PostgREST vía `?select=...`.
 *  - NO devuelve costo_promedio, proveedor_principal_id, stock exacto, ni
 *    cualquier otro dato interno.
 *  - stock_actual → disponible:boolean (no se expone el número).
 *  - precio = COALESCE(precio_web, precio_venta), calculado en JS.
 *  - Filtro forzado activo=eq.true AND visible_web=eq.true.
 *  - CORS controlado por env ELEVATE_PUBLIC_WEB_ORIGIN.
 *  - Cache HTTP corto para reducir carga.
 *
 * Transporte: PostgREST HTTPS (sin pool PG directo, sin SUPABASE_DB_URL).
 * Anon como path preferido; SR como fallback server-side si anon no tiene
 * GRANT SELECT (caso típico self-hosted sin policy abierta).
 *
 * Query params soportados:
 *   ?limit=20  (1-100, default 20)
 *   ?page=1    (>=1, default 1)
 *   ?destacado=true  (filtra solo destacados)
 */
import { NextRequest, NextResponse } from "next/server";
import { elevatePublicCorsHeaders, PUBLIC_CATALOG_CACHE } from "@/lib/public-api/cors";
import { postgrestGet } from "@/lib/elevate-public/catalog-postgrest";

export const dynamic = "force-dynamic";

/** Columnas crudas que pedimos. `select` mapea a alias finales del API. */
const PUBLIC_SELECT =
  "id," +
  "slug:slug_web," +
  "nombre," +
  "marca," +
  "precio_web," +
  "precio_venta," +
  "imagen_url," +
  "descripcion_corta," +
  "destacado:destacado_web," +
  "stock_actual";

type ProductoRaw = {
  id: string;
  slug: string | null;
  nombre: string | null;
  marca: string | null;
  precio_web: number | null;
  precio_venta: number | null;
  imagen_url: string | null;
  descripcion_corta: string | null;
  destacado: boolean | null;
  stock_actual: number | null;
};

type ProductoPublico = {
  id: string;
  slug: string | null;
  nombre: string | null;
  marca: string | null;
  precio: number;
  imagen_url: string | null;
  descripcion_corta: string | null;
  destacado: boolean;
  disponible: boolean;
};

function toPublico(r: ProductoRaw): ProductoPublico {
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

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const pageRaw = parseInt(url.searchParams.get("page") ?? "1", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
    const offset = (page - 1) * limit;
    const destacadoOnly = url.searchParams.get("destacado") === "true";

    const qs = new URLSearchParams({
      select: PUBLIC_SELECT,
      activo: "eq.true",
      visible_web: "eq.true",
      order: "destacado_web.desc,nombre.asc",
      limit: String(limit),
      offset: String(offset),
    });
    if (destacadoOnly) qs.set("destacado_web", "eq.true");

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
        headers: {
          ...PUBLIC_CATALOG_CACHE,
          ...elevatePublicCorsHeaders(),
        },
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

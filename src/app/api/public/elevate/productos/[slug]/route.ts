/**
 * GET /api/public/elevate/productos/[slug]
 *
 * Detalle público de producto por slug_web. Mismas garantías de seguridad
 * que el listado: whitelist estricta, sin costo/proveedor/stock interno,
 * filtra activo=true AND visible_web=true.
 */
import { NextRequest, NextResponse } from "next/server";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { queryWithRetry } from "@/lib/supabase/pg-retry";
import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";
import { elevatePublicCorsHeaders, PUBLIC_CATALOG_CACHE } from "@/lib/public-api/cors";

export const dynamic = "force-dynamic";

const PUBLIC_DETAIL_LIST = `
  id,
  slug_web              AS slug,
  nombre,
  marca,
  COALESCE(precio_web, precio_venta) AS precio,
  imagen_url,
  descripcion_corta,
  descripcion_web,
  destacado_web         AS destacado,
  (stock_actual > 0)    AS disponible
`;

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

    const pool = getChatPostgresPool();
    if (!pool) {
      return NextResponse.json(
        { error: "Pool no disponible" },
        { status: 500, headers: elevatePublicCorsHeaders() }
      );
    }

    const t = quoteSchemaTable(SUPABASE_APP_SCHEMA, "productos");
    const { rows } = await queryWithRetry(
      pool,
      `SELECT ${PUBLIC_DETAIL_LIST}
         FROM ${t}
        WHERE activo = true
          AND visible_web = true
          AND slug_web = $1
        LIMIT 1`,
      [cleanSlug]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404, headers: elevatePublicCorsHeaders() }
      );
    }

    return NextResponse.json(
      { producto: rows[0] },
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
      "[/api/public/elevate/productos/[slug] GET]",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "No se pudo cargar el producto." },
      { status: 500, headers: elevatePublicCorsHeaders() }
    );
  }
}

/**
 * GET /api/public/elevate/productos
 *
 * Endpoint público del catálogo (sin auth). Diseñado para que la web pública
 * de Elevate consuma productos publicados (visible_web=true AND activo=true).
 *
 * Seguridad:
 *  - Whitelist estricta de columnas: NUNCA SELECT *.
 *  - NO devuelve costo_promedio, proveedor_principal_id, stock exacto, ni
 *    cualquier otro dato interno.
 *  - stock_actual → disponible:boolean (no se expone el número).
 *  - Filtro forzado WHERE visible_web=true AND activo=true.
 *  - CORS controlado por env ELEVATE_PUBLIC_WEB_ORIGIN.
 *  - Cache HTTP corto para reducir carga.
 *
 * Query params soportados:
 *   ?limit=20  (1-100, default 20)
 *   ?page=1    (>=1, default 1)
 *   ?destacado=true  (filtra solo destacados)
 */
import { NextRequest, NextResponse } from "next/server";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { queryWithRetry } from "@/lib/supabase/pg-retry";
import { SUPABASE_APP_SCHEMA } from "@/lib/supabase/schema";
import { elevatePublicCorsHeaders, PUBLIC_CATALOG_CACHE } from "@/lib/public-api/cors";

export const dynamic = "force-dynamic";

const PUBLIC_SELECT_LIST = `
  id,
  slug_web              AS slug,
  nombre,
  marca,
  COALESCE(precio_web, precio_venta) AS precio,
  imagen_url,
  descripcion_corta,
  destacado_web         AS destacado,
  (stock_actual > 0)    AS disponible
`;

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

    const pool = getChatPostgresPool();
    if (!pool) {
      return NextResponse.json(
        { error: "Pool no disponible" },
        { status: 500, headers: elevatePublicCorsHeaders() }
      );
    }

    const t = quoteSchemaTable(SUPABASE_APP_SCHEMA, "productos");
    const whereExtra = destacadoOnly ? " AND destacado_web = true" : "";

    const { rows } = await queryWithRetry(
      pool,
      `SELECT ${PUBLIC_SELECT_LIST}
         FROM ${t}
        WHERE activo = true
          AND visible_web = true
          ${whereExtra}
        ORDER BY destacado_web DESC, nombre ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return NextResponse.json(
      { productos: rows, page, limit, count: rows.length },
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
      "[/api/public/elevate/productos GET]",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "No se pudieron cargar los productos." },
      { status: 500, headers: elevatePublicCorsHeaders() }
    );
  }
}

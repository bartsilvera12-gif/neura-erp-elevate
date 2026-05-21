import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  rowToProductoApi,
  DuplicadoError,
} from "@/lib/inventario/server/productos-pg";
import {
  existsInTenantPostgrest,
  updateProductoPostgrest,
  setCategoriaPrincipalPostgrest,
} from "@/lib/inventario/server/productos-postgrest";
import { postgrestGet, getAccessTokenForRequest } from "@/lib/supabase/postgrest-runtime";
import { syncCatalogoExtras } from "@/lib/inventario/server/catalogo-web-extras";

const PRODUCTO_COLS_PRIV =
  "id,empresa_id,nombre,sku,costo_promedio,precio_venta,stock_actual,stock_minimo," +
  "unidad_medida,metodo_valuacion,activo,created_at,updated_at," +
  "codigo_barras,codigo_barras_interno,imagen_path,imagen_url," +
  "categoria_principal_id,ubicacion_principal_id,proveedor_principal_id," +
  "slug_web,visible_web,destacado_web,descripcion_corta,descripcion_web,marca,precio_web";

type ProductoRow = Record<string, unknown> & { id?: string };

/**
 * GET /api/productos/[id] — lee un producto vía PostgREST HTTPS con JWT del
 * usuario. RLS por empresa + filtro defensivo empresa_id=eq.X.
 */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const jwt = await getAccessTokenForRequest(request);
    const qs = new URLSearchParams({
      select: PRODUCTO_COLS_PRIV,
      empresa_id: `eq.${empresaId}`,
      id: `eq.${id}`,
      limit: "1",
    });
    const r = await postgrestGet<ProductoRow>("productos", qs.toString(), {
      role: "jwt",
      jwt,
      noStore: true,
    });
    if (!r.ok) {
      console.error("[/api/productos/[id] GET]", r.error);
      return NextResponse.json(errorResponse("No se pudo cargar el producto."), { status: 502 });
    }
    const row = r.rows[0];
    if (!row) return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    // rowToProductoApi normaliza shape (string IDs, etc.)
    return NextResponse.json(successResponse({ producto: rowToProductoApi(row as never) }));
  } catch (err) {
    console.error("[/api/productos/[id] GET] uncaught", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el producto."), { status: 500 });
  }
}
import { normalizeUpperText, normalizeUpperCodigoBarras } from "@/lib/text/normalize";

/**
 * Legacy pool-based existsInTenant — quedó como referencia. NO usar en
 * runtime web. Mantenido para no romper imports indirectos si los hubiera.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

async function existsInTenant(
  schema: string,
  empresaId: string,
  table: "categorias_productos" | "inventario_ubicaciones" | "proveedores",
  id: string
): Promise<boolean> {
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const s = assertAllowedChatDataSchema(schema);
  const t = quoteSchemaTable(s, table);
  const { rows } = await pool.query<{ ok: number }>(
    `SELECT 1 AS ok FROM ${t} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
    [id, empresaId]
  );
  return rows.length > 0;
}

/**
 * PATCH /api/productos/[id]
 *
 * Update parcial vía PostgREST HTTPS con JWT del usuario. RLS por empresa
 * cubre ownership. Aplica solo los campos presentes en el body.
 */
export async function PATCH(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;
    const jwt = await getAccessTokenForRequest(request);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(errorResponse("JSON inválido."), { status: 400 });
    }

    const patch: Parameters<typeof updateProductoPostgrest>[3] = {};
    if (body.nombre !== undefined) patch.nombre = normalizeUpperText(body.nombre);
    if (body.sku !== undefined) patch.sku = normalizeUpperText(body.sku);
    if (body.costo_promedio !== undefined) patch.costo_promedio = Number(body.costo_promedio) || 0;
    if (body.precio_venta !== undefined) patch.precio_venta = Number(body.precio_venta) || 0;
    if (body.stock_actual !== undefined) patch.stock_actual = Number(body.stock_actual) || 0;
    if (body.stock_minimo !== undefined) patch.stock_minimo = Number(body.stock_minimo) || 0;
    if (body.unidad_medida !== undefined) patch.unidad_medida = normalizeUpperText(body.unidad_medida) || "UNIDAD";
    if (body.metodo_valuacion !== undefined) {
      const mv = body.metodo_valuacion;
      patch.metodo_valuacion = mv === "FIFO" || mv === "LIFO" ? mv : "CPP";
    }
    if (body.codigo_barras !== undefined) {
      patch.codigo_barras = normalizeUpperCodigoBarras(body.codigo_barras);
    }
    if (body.codigo_barras_interno !== undefined) {
      patch.codigo_barras_interno = body.codigo_barras_interno === true;
    }
    if (body.imagen_path !== undefined) {
      const v = body.imagen_path != null ? String(body.imagen_path) : "";
      patch.imagen_path = v || null;
    }
    if (body.imagen_url !== undefined) {
      const v = body.imagen_url != null ? String(body.imagen_url) : "";
      patch.imagen_url = v || null;
    }

    // Relaciones opcionales — validar ownership
    let categoriaCambia = false;
    let categoriaNueva: string | null = null;
    if (body.categoria_principal_id !== undefined) {
      const v = body.categoria_principal_id == null ? null : String(body.categoria_principal_id);
      if (v && !(await existsInTenantPostgrest(jwt, empresaId, "categorias_productos", v))) {
        return NextResponse.json(errorResponse("La categoría seleccionada no existe."), { status: 400 });
      }
      patch.categoria_principal_id = v;
      categoriaCambia = true;
      categoriaNueva = v;
    }
    if (body.ubicacion_principal_id !== undefined) {
      const v = body.ubicacion_principal_id == null ? null : String(body.ubicacion_principal_id);
      if (v && !(await existsInTenantPostgrest(jwt, empresaId, "inventario_ubicaciones", v))) {
        return NextResponse.json(errorResponse("La ubicación seleccionada no existe."), { status: 400 });
      }
      patch.ubicacion_principal_id = v;
    }
    if (body.proveedor_principal_id !== undefined) {
      const v = body.proveedor_principal_id == null ? null : String(body.proveedor_principal_id);
      if (v && !(await existsInTenantPostgrest(jwt, empresaId, "proveedores", v))) {
        return NextResponse.json(errorResponse("El proveedor seleccionado no existe."), { status: 400 });
      }
      patch.proveedor_principal_id = v;
    }

    // Campos web pública (Fase 1)
    if (body.slug_web !== undefined) {
      const v = typeof body.slug_web === "string" ? body.slug_web.trim().toLowerCase() : "";
      patch.slug_web = v || null;
    }
    if (body.visible_web !== undefined) patch.visible_web = body.visible_web === true;
    if (body.destacado_web !== undefined) patch.destacado_web = body.destacado_web === true;
    if (body.descripcion_corta !== undefined) {
      patch.descripcion_corta = typeof body.descripcion_corta === "string" ? body.descripcion_corta : null;
    }
    if (body.descripcion_web !== undefined) {
      patch.descripcion_web = typeof body.descripcion_web === "string" ? body.descripcion_web : null;
    }
    if (body.marca !== undefined) {
      patch.marca = typeof body.marca === "string" ? body.marca.trim() || null : null;
    }
    if (body.precio_web !== undefined) {
      const v = body.precio_web;
      if (v === null || v === "") patch.precio_web = null;
      else patch.precio_web = Number.isFinite(Number(v)) ? Number(v) : null;
    }

    // Catálogo enriquecido (Fase 1 catálogo)
    const numOrNull = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const strOrNull = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : v === null || v === "" ? null : null;

    if (body.precio_oferta !== undefined) patch.precio_oferta = numOrNull(body.precio_oferta);
    if (body.oferta_hasta !== undefined) patch.oferta_hasta = strOrNull(body.oferta_hasta);
    if (body.nuevo_hasta !== undefined) patch.nuevo_hasta = strOrNull(body.nuevo_hasta);
    if (body.concentracion !== undefined) {
      patch.concentracion = typeof body.concentracion === "string" ? body.concentracion.trim() || null : null;
    }
    if (body.volumen_ml !== undefined) {
      const v = numOrNull(body.volumen_ml);
      patch.volumen_ml = v == null ? null : Math.max(0, Math.floor(v));
    }
    if (body.genero !== undefined) {
      const g = typeof body.genero === "string" ? body.genero.trim().toLowerCase() : "";
      patch.genero = g === "masculino" || g === "femenino" || g === "unisex" ? g : null;
    }
    if (body.proximamente !== undefined) patch.proximamente = body.proximamente === true;
    if (body.orden_web !== undefined) {
      const v = numOrNull(body.orden_web);
      patch.orden_web = v == null ? null : Math.floor(v);
    }
    if (body.familia_olfativa_id !== undefined) {
      patch.familia_olfativa_id = strOrNull(body.familia_olfativa_id);
    }

    try {
      const row = await updateProductoPostgrest(jwt, empresaId, id, patch);
      if (!row) {
        return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
      }
      // Catálogo enriquecido: familia + notas (opt-in por body)
      try {
        const arr = (v: unknown): string[] =>
          Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()) : [];
        const hasFamilia = body.familia_olfativa_nombre !== undefined;
        const hasNotas = body.notas_top !== undefined || body.notas_heart !== undefined || body.notas_base !== undefined;
        if (hasFamilia || hasNotas) {
          const familiaNombre = hasFamilia
            ? typeof body.familia_olfativa_nombre === "string"
              ? body.familia_olfativa_nombre.trim() || null
              : null
            : undefined;
          await syncCatalogoExtras(jwt, empresaId, id, {
            familia_nombre: familiaNombre,
            notas_top: body.notas_top !== undefined ? arr(body.notas_top) : undefined,
            notas_heart: body.notas_heart !== undefined ? arr(body.notas_heart) : undefined,
            notas_base: body.notas_base !== undefined ? arr(body.notas_base) : undefined,
          });
        }
      } catch (err) {
        console.error("[/api/productos/[id]] syncCatalogoExtras fallo", {
          empresaId, id,
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // Sincronizar categoria principal en puente producto_categorias
      if (categoriaCambia) {
        try {
          await setCategoriaPrincipalPostgrest(jwt, empresaId, id, categoriaNueva);
        } catch (err) {
          console.error("[/api/productos/[id]] setCategoriaPrincipal fallo", {
            empresaId, id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return NextResponse.json(successResponse({ producto: rowToProductoApi(row) }));
    } catch (err) {
      if (err instanceof DuplicadoError) {
        return NextResponse.json(errorResponse(err.message), { status: 409 });
      }
      console.error("[/api/productos/[id] PATCH]", {
        empresaId,
        id,
        message: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string })?.code,
      });
      return NextResponse.json(
        errorResponse("No se pudo actualizar el producto. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/productos/[id] PATCH] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo actualizar el producto."),
      { status: 500 }
    );
  }
}

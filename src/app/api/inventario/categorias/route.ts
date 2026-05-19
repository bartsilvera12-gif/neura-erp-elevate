import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  insertCategoriaProducto,
} from "@/lib/inventario/server/catalogos-pg";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";
import { postgrestGet, getAccessTokenForRequest } from "@/lib/supabase/postgrest-runtime";

const CATEGORIAS_COLS = "id,empresa_id,nombre,codigo,descripcion,parent_id,activo,created_at,updated_at";

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const jwt = await getAccessTokenForRequest(request);
    const url = new URL(request.url);
    const todas = url.searchParams.get("todas") === "1";
    const qs = new URLSearchParams({
      select: CATEGORIAS_COLS,
      empresa_id: `eq.${empresaId}`,
      order: "nombre.asc",
      limit: "1000",
    });
    if (!todas) qs.set("activo", "eq.true");
    const r = await postgrestGet<Record<string, unknown>>(
      "categorias_productos",
      qs.toString(),
      { role: "jwt", jwt, noStore: true }
    );
    if (!r.ok) {
      console.error("[/api/inventario/categorias GET]", r.error);
      return NextResponse.json(errorResponse("No se pudieron cargar las categorías."), { status: 502 });
    }
    return NextResponse.json(successResponse({ categorias: r.rows }));
  } catch (err) {
    console.error("[/api/inventario/categorias GET] uncaught", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las categorías."), { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const nombre = normalizeUpperText(body.nombre);
    if (!nombre) return NextResponse.json(errorResponse("El nombre es obligatorio."), { status: 400 });
    try {
      const row = await insertCategoriaProducto(schema, ctx.auth.empresa_id, {
        nombre,
        codigo: normalizeUpperNullable(body.codigo),
        descripcion: normalizeUpperNullable(body.descripcion),
        parent_id: body.parent_id == null ? null : String(body.parent_id),
        activo: body.activo === false ? false : true,
      });
      return NextResponse.json(successResponse({ categoria: row }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/uq_categorias_productos_empresa_nombre|duplicate/i.test(msg)) {
        return NextResponse.json(
          errorResponse("Ya existe una categoría con ese nombre."),
          { status: 409 }
        );
      }
      console.error("[/api/inventario/categorias POST]", { schema, msg });
      return NextResponse.json(errorResponse("No se pudo crear la categoría."), { status: 500 });
    }
  } catch (err) {
    console.error("[/api/inventario/categorias POST] outer", err);
    return NextResponse.json(errorResponse("No se pudo crear la categoría."), { status: 500 });
  }
}

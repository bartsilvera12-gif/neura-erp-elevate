import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { postgrestRpc } from "@/lib/supabase/postgrest-runtime";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

export const INTERNAL_CODE_PREFIX = "ELE-PER-";

/**
 * POST /api/productos/codigo-interno
 *
 * Genera atómicamente un código interno único en formato:
 *     ELE-PER-{SEQ6}   (p. ej. ELE-PER-000001)
 *
 * Transporte: PostgREST HTTPS → RPC elevate.generar_codigo_producto_interno.
 * NO usa pg pool directo: el runtime Hostinger no tiene acceso al puerto 5432.
 * La RPC es SECURITY DEFINER y maneja el UPSERT en
 * elevate.productos_codigo_secuencia + validación de unicidad.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const empresaId = ctx.auth.empresa_id;

    const r = await postgrestRpc<string>(
      "generar_codigo_producto_interno",
      { p_empresa_id: empresaId },
      { role: "service_role" }
    );

    if (!r.ok) {
      console.error("[/api/productos/codigo-interno]", r.error);
      return NextResponse.json(
        errorResponse("No se pudo generar el código interno. Intentá nuevamente."),
        { status: 502 }
      );
    }

    // PostgREST devuelve la scalar text como string en rows[0] o como array.
    const raw = r.rows[0];
    const codigo = typeof raw === "string" ? raw.trim() : "";
    if (!codigo) {
      return NextResponse.json(
        errorResponse("La RPC devolvió un valor vacío."),
        { status: 502 }
      );
    }

    return NextResponse.json(successResponse({ codigo, interno: true }));
  } catch (err) {
    console.error("[/api/productos/codigo-interno] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(
      errorResponse("No se pudo generar el código interno."),
      { status: 500 }
    );
  }
}

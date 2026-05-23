import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { resolveEffectiveDashboardViews } from "@/lib/dashboard/resolve-effective-dashboard-views";
import { NextResponse } from "next/server";

type DashView = { id: string; nombre: string; slug: string; orden: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCatalogoActivo(supabase: any): Promise<DashView[]> {
  const { data, error } = await supabase
    .from("dashboard_views")
    .select("id, nombre, slug, orden")
    .eq("activo", true)
    .order("orden", { ascending: true });
  if (error || !Array.isArray(data)) return [];
  return data.map((m: { id?: unknown; nombre?: unknown; slug?: unknown; orden?: unknown }) => ({
    id: String(m.id ?? ""),
    nombre: String(m.nombre ?? ""),
    slug: String(m.slug ?? ""),
    orden: Number(m.orden) || 0,
  }));
}

/**
 * GET /api/empresas/mis-dashboard-views
 *
 * Devuelve las vistas habilitadas para el usuario autenticado.
 *
 * Fallback defensivo (single_client / Elevate):
 *   - Si el usuario está autenticado en Supabase Auth pero no se logra mapear
 *     a una fila de elevate.usuarios (auth_user_id sin match + email sin
 *     match), igual devolvemos las vistas activas del catálogo. En modo
 *     single_client la empresa es única y las vistas son operativas, no
 *     contienen datos sensibles cross-tenant. Sin este fallback el dashboard
 *     queda con "Sin vistas asignadas" aunque la empresa tenga vistas y el
 *     usuario sí esté logueado.
 */
export async function GET(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const user = await getAuthUserForApiRoute(request);
    if (!user?.id) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const usuario = await resolveUsuarioErpFromAuthUser(supabase, user);

    // Fallback 1: si no se resolvió el usuario ERP, devolver el catálogo
    // activo. Instancia single_client = sin riesgo cross-tenant.
    if (!usuario) {
      console.warn("[mis-dashboard-views] resolveUsuario null", {
        authUserId: user.id,
        email: user.email ?? null,
      });
      const views = await fetchCatalogoActivo(supabase);
      return NextResponse.json({
        views,
        defaultSlug: views[0]?.slug ?? null,
        defaultViewId: views[0]?.id ?? null,
      });
    }

    let eff;
    try {
      eff = await resolveEffectiveDashboardViews(supabase, {
        id: usuario.id,
        empresa_id: usuario.empresa_id,
        rol: usuario.rol,
      });
    } catch (e) {
      console.error("[mis-dashboard-views] resolver throw", e);
      eff = { views: [], defaultViewId: null, defaultSlug: null };
    }

    // Fallback 2: si el resolver devuelve 0 vistas por cualquier razón (RLS
    // edge case, race condition, env mal cargada), devolver el catálogo
    // activo. Sin esto el dashboard queda con "Sin vistas asignadas".
    if (eff.views.length === 0) {
      console.warn("[mis-dashboard-views] resolver retornó 0 views → fallback catalogo", {
        usuario_id: usuario.id,
        empresa_id: usuario.empresa_id,
        rol: usuario.rol,
      });
      const views = await fetchCatalogoActivo(supabase);
      return NextResponse.json({
        views,
        defaultSlug: views[0]?.slug ?? null,
        defaultViewId: views[0]?.id ?? null,
      });
    }

    return NextResponse.json({
      views: eff.views.map((v) => ({
        id: v.id,
        nombre: v.nombre,
        slug: v.slug,
        orden: v.orden,
      })),
      defaultSlug: eff.defaultSlug,
      defaultViewId: eff.defaultViewId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error("[mis-dashboard-views] outer", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

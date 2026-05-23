import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getAuthUserForApiRoute } from "@/lib/auth/get-auth-user-for-api-route";
import { resolveUsuarioErpFromAuthUser } from "@/lib/auth/resolve-usuario-erp";
import { resolveEffectiveDashboardViews } from "@/lib/dashboard/resolve-effective-dashboard-views";
import { isStrictAllowlistMode } from "@/lib/modulos/resolve-effective-modules";
import { NextResponse } from "next/server";

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

    if (!usuario) {
      console.warn("[mis-dashboard-views] resolveUsuario null", {
        authUserId: user.id,
        email: user.email ?? null,
      });
      // Fallback single_client: devolver el catálogo activo.
      if (isStrictAllowlistMode()) {
        try {
          const { data, error } = await supabase
            .from("dashboard_views")
            .select("id, nombre, slug, orden")
            .eq("activo", true)
            .order("orden", { ascending: true });
          if (!error && Array.isArray(data) && data.length > 0) {
            const views = data.map((m: { id?: unknown; nombre?: unknown; slug?: unknown; orden?: unknown }) => ({
              id: String(m.id ?? ""),
              nombre: String(m.nombre ?? ""),
              slug: String(m.slug ?? ""),
              orden: Number(m.orden) || 0,
            }));
            return NextResponse.json({
              views,
              defaultSlug: views[0]?.slug ?? null,
              defaultViewId: views[0]?.id ?? null,
            });
          }
        } catch (e) {
          console.error("[mis-dashboard-views] fallback catalog query", e);
        }
      }
      return NextResponse.json({ views: [], defaultSlug: null, defaultViewId: null });
    }

    const eff = await resolveEffectiveDashboardViews(supabase, {
      id: usuario.id,
      empresa_id: usuario.empresa_id,
      rol: usuario.rol,
    });

    // Log defensivo: si después de resolver el usuario igual quedan 0 vistas,
    // dejamos rastro en logs sin exponer datos sensibles.
    if (eff.views.length === 0) {
      console.warn("[mis-dashboard-views] resolver retornó 0 views", {
        usuario_id: usuario.id,
        empresa_id: usuario.empresa_id,
        rol: usuario.rol,
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

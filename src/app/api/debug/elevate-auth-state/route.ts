import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/debug/elevate-auth-state
 *
 * Diagnóstico de estado de auth/módulos en el schema elevate SIN exponer
 * secretos, emails de otros usuarios, ni tokens.
 *
 * Confirma:
 *   - schema activo configurado vs el que PostgREST acepta
 *   - admin@elevate.com existe en elevate.usuarios + rol + empresa_id + auth_user_id presente
 *   - conteos: empresas, usuarios, módulos catálogo, empresa_modulos activos
 *   - service role puede leer elevate.usuarios (test efectivo)
 *
 * Endpoint público de solo lectura. Borrar cuando el deploy esté estable.
 */
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "admin@elevate.com";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const schemaEnv = process.env.NEURA_CLIENT_SCHEMA?.trim() || "elevate";
  const mode = process.env.NEURA_INSTANCE_MODE?.trim() ?? "<unset>";

  const report: Record<string, unknown> = {
    schema_env: schemaEnv,
    mode,
  };

  if (!url || !sr) {
    return NextResponse.json({
      ...report,
      error: "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en runtime",
      has_url: !!url,
      has_sr: !!sr,
    });
  }

  const client = createClient(url, sr, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: schemaEnv },
  });

  async function count(table: string, filters?: Record<string, unknown>) {
    try {
      let q = client.from(table).select("*", { count: "exact", head: true });
      if (filters) for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never);
      const { count: c, error, status } = await q;
      return { count: c ?? 0, status, error: error?.message ?? null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  report.counts = {
    empresas: await count("empresas"),
    usuarios: await count("usuarios"),
    modulos: await count("modulos"),
    empresa_modulos_activos: await count("empresa_modulos", { activo: true }),
  };

  // Admin lookup — solo devolvemos rol, has_auth_user_id, has_empresa, activo. No email.
  try {
    const { data, error, status } = await client
      .from("usuarios")
      .select("id, rol, activo, empresa_id, auth_user_id, email")
      .ilike("email", ADMIN_EMAIL)
      .limit(1);
    if (error) {
      report.admin = { error: error.message, status };
    } else {
      const row = (data ?? [])[0] as Record<string, unknown> | undefined;
      if (!row) {
        report.admin = { exists: false };
      } else {
        report.admin = {
          exists: true,
          rol: row.rol ?? null,
          activo: row.activo ?? null,
          has_empresa_id: !!row.empresa_id,
          has_auth_user_id: !!row.auth_user_id,
          email_domain_match: typeof row.email === "string" && row.email.toLowerCase().endsWith("@elevate.com"),
        };

        // Módulos activos de la empresa del admin (si tiene empresa)
        if (row.empresa_id) {
          const emp = await client
            .from("empresa_modulos")
            .select("modulo_id, activo")
            .eq("empresa_id", row.empresa_id)
            .eq("activo", true);
          report.admin_empresa_modulos = {
            count: emp.data?.length ?? 0,
            status: emp.status,
            error: emp.error?.message ?? null,
          };

          // usuario_modulos del admin
          const um = await client
            .from("usuario_modulos")
            .select("modulo_id")
            .eq("usuario_id", row.id as string);
          report.admin_usuario_modulos = {
            count: um.data?.length ?? 0,
            status: um.status,
            error: um.error?.message ?? null,
          };
        }
      }
    }
  } catch (e) {
    report.admin = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test efectivo: PostgREST acepta SR contra schema configurado
  try {
    const r = await fetch(`${url}/rest/v1/usuarios?select=id&limit=1`, {
      headers: {
        apikey: sr,
        Authorization: `Bearer ${sr}`,
        "Accept-Profile": schemaEnv,
      },
      cache: "no-store",
    });
    report.postgrest_sr_test = {
      status: r.status,
      ok: r.ok,
      body_preview: (await r.text()).slice(0, 200),
    };
  } catch (e) {
    report.postgrest_sr_test = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(report);
}

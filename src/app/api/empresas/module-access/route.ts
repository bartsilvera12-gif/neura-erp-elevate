import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { supabaseDbSchemaOption, type AppSupabaseClient } from "@/lib/supabase/schema";
import { isErpRolSupervisor } from "@/lib/usuarios/erp-rol-normalize";

/**
 * Slugs de módulos efectivos para el usuario autenticado (intersección empresa ∩ usuario).
 *
 * Optimizado para instancia single_client (Elevate) en Hostinger hPanel donde la
 * latencia Hostinger Paraguay → Supabase US (~1.5-2s por round-trip) hace que
 * la resolución secuencial original (8-13 queries) tarde 19-23s.
 *
 * Estrategia:
 *   - 1 sola llamada `auth.getUser` (bearer header o cookies).
 *   - Sin `auth.admin.getUserById` (HTTP extra innecesario).
 *   - Sin doble flujo SR → JWT. Solo JWT del usuario contra PostgREST con grants
 *     a `authenticated` en `elevate.*` (lo que ya funciona en producción).
 *   - 2 queries en paralelo: usuarios + catálogo modulos.
 *   - 2 queries en paralelo: empresa_modulos + usuario_modulos.
 *   - Cálculo local de la intersección de módulos.
 *   - Cache in-memory por instance del runtime (TTL 60s) — repetidos requests
 *     desde el mismo usuario en la misma instancia evitan re-querying.
 *   - Logs `[ma-timing]` con tiempos por etapa para diagnóstico en prod.
 */

const TIMING_TAG = "[ma-timing]";
const MODULE_CACHE_TTL_MS = 60_000;

type ModuloLite = { id: string; nombre: string; slug: string };
type Payload = { superAdmin: boolean; slugs: string[]; modulos: ModuloLite[] };
type CacheEntry = { ts: number; payload: Payload };

const moduleCache = new Map<string, CacheEntry>();

const SLUGS_OMNICANAL_SUPERVISOR = new Set([
  "conversaciones",
  "omnicanal",
  "historial-omnicanal",
  "conversaciones-finalizadas",
  "monitoreo",
]);

function readCache(userId: string): Payload | null {
  const v = moduleCache.get(userId);
  if (!v) return null;
  if (Date.now() - v.ts > MODULE_CACHE_TTL_MS) {
    moduleCache.delete(userId);
    return null;
  }
  return v.payload;
}

function writeCache(userId: string, payload: Payload): void {
  moduleCache.set(userId, { ts: Date.now(), payload });
}

function elapsedMs(t0: number): number {
  return Math.round(performance.now() - t0);
}

function extractBearer(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h?.toLowerCase().startsWith("bearer ")) return null;
  const t = h.slice(7).trim();
  return t || null;
}

export async function GET(request: Request) {
  const total0 = performance.now();
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !anonKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    // ── 1) Auth ──────────────────────────────────────────────────────────
    const tAuth0 = performance.now();
    const bearer = extractBearer(request);
    let userId: string;
    let userEmail: string | null;
    let userScoped: AppSupabaseClient;

    if (bearer) {
      const authOnly = createClient(url, anonKey);
      const { data, error } = await authOnly.auth.getUser(bearer);
      if (error || !data.user?.id) {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      }
      userId = data.user.id;
      userEmail = data.user.email ?? null;
      userScoped = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        ...supabaseDbSchemaOption,
      }) as AppSupabaseClient;
    } else {
      const cookieStore = await cookies();
      const authOnly = createServerClient(url, anonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      });
      const { data, error } = await authOnly.auth.getUser();
      if (error || !data.user?.id) {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      }
      userId = data.user.id;
      userEmail = data.user.email ?? null;
      userScoped = createServerClient(url, anonKey, {
        ...supabaseDbSchemaOption,
        cookies: {
          getAll() {
            return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }) as AppSupabaseClient;
    }
    const tAuth = elapsedMs(tAuth0);

    // ── 2) Cache hit ────────────────────────────────────────────────────
    const cached = readCache(userId);
    if (cached) {
      const total = elapsedMs(total0);
      console.log(
        `${TIMING_TAG} cache_hit user=${userId.slice(0, 8)} tAuth=${tAuth}ms total=${total}ms slugs=${cached.slugs.length}`
      );
      return NextResponse.json(cached);
    }

    // ── 3) usuarios + catalogo modulos en PARALELO ─────────────────────
    const tQ1 = performance.now();
    const [usuariosResult, modulosResult] = await Promise.all([
      userScoped
        .from("usuarios")
        .select("id, empresa_id, rol")
        .eq("auth_user_id", userId)
        .limit(1),
      userScoped.from("modulos").select("id, nombre, slug").order("slug"),
    ]);
    const tQueries = elapsedMs(tQ1);

    type UsuarioRow = { id: string; empresa_id: string | null; rol: string | null };
    let usuario: UsuarioRow | null =
      ((usuariosResult.data as UsuarioRow[] | null) ?? [])[0] ?? null;
    const allModulos: ModuloLite[] =
      ((modulosResult.data as ModuloLite[] | null) ?? []).filter((m) => m.slug);

    // Fallback por email solo si no encontró por auth_user_id.
    let tEmail = 0;
    if (!usuario && userEmail) {
      const tE0 = performance.now();
      const { data: byEmail } = await userScoped
        .from("usuarios")
        .select("id, empresa_id, rol")
        .ilike("email", userEmail)
        .limit(1);
      tEmail = elapsedMs(tE0);
      usuario = ((byEmail as UsuarioRow[] | null) ?? [])[0] ?? null;
    }

    const bootstrapSuper = isBootstrapSuperAdminEmail(userEmail);

    // ── 4) Super-admin paths ────────────────────────────────────────────
    if (!usuario && bootstrapSuper) {
      const payload: Payload = {
        superAdmin: true,
        slugs: allModulos.map((m) => m.slug),
        modulos: allModulos,
      };
      writeCache(userId, payload);
      console.log(
        `${TIMING_TAG} bootstrap_super user=${userId.slice(0, 8)} tAuth=${tAuth}ms tQueries=${tQueries}ms total=${elapsedMs(total0)}ms`
      );
      return NextResponse.json(payload);
    }

    if (!usuario) {
      const payload: Payload = { superAdmin: false, slugs: [], modulos: [] };
      console.log(
        `${TIMING_TAG} no_usuario user=${userId.slice(0, 8)} tAuth=${tAuth}ms tQueries=${tQueries}ms tEmail=${tEmail}ms total=${elapsedMs(total0)}ms`
      );
      return NextResponse.json(payload);
    }

    const rol = (usuario.rol ?? "").trim();
    if (rol === "super_admin") {
      const payload: Payload = {
        superAdmin: true,
        slugs: allModulos.map((m) => m.slug),
        modulos: allModulos,
      };
      writeCache(userId, payload);
      console.log(
        `${TIMING_TAG} super_admin user=${userId.slice(0, 8)} tAuth=${tAuth}ms tQueries=${tQueries}ms total=${elapsedMs(total0)}ms`
      );
      return NextResponse.json(payload);
    }

    if (!usuario.empresa_id) {
      const payload: Payload = { superAdmin: false, slugs: [], modulos: [] };
      writeCache(userId, payload);
      console.log(
        `${TIMING_TAG} no_empresa user=${userId.slice(0, 8)} tAuth=${tAuth}ms tQueries=${tQueries}ms total=${elapsedMs(total0)}ms`
      );
      return NextResponse.json(payload);
    }

    // ── 5) empresa_modulos + usuario_modulos en PARALELO ───────────────
    const tM0 = performance.now();
    const [emResult, umResult] = await Promise.all([
      userScoped
        .from("empresa_modulos")
        .select("modulo_id")
        .eq("empresa_id", usuario.empresa_id)
        .eq("activo", true),
      userScoped.from("usuario_modulos").select("modulo_id").eq("usuario_id", usuario.id),
    ]);
    const tMod = elapsedMs(tM0);

    const empresaModuloIds = new Set(
      ((emResult.data as { modulo_id: string }[] | null) ?? [])
        .map((r) => (r.modulo_id != null ? String(r.modulo_id) : ""))
        .filter((x) => x.length > 0)
    );
    const userModuloIds = new Set(
      ((umResult.data as { modulo_id: string }[] | null) ?? [])
        .map((r) => (r.modulo_id != null ? String(r.modulo_id) : ""))
        .filter((x) => x.length > 0)
    );

    const isAdminEmpresa = rol === "admin" || rol === "administrador";
    const isSupervisor = isErpRolSupervisor(rol);

    let efectivos: ModuloLite[];
    if (isAdminEmpresa) {
      efectivos = allModulos.filter((m) => empresaModuloIds.has(m.id));
    } else {
      // Sin filas en usuario_modulos: hereda módulos activos de la empresa.
      const idsBase =
        userModuloIds.size === 0
          ? new Set(empresaModuloIds)
          : new Set([...userModuloIds].filter((id) => empresaModuloIds.has(id)));

      if (isSupervisor) {
        for (const m of allModulos) {
          if (empresaModuloIds.has(m.id) && SLUGS_OMNICANAL_SUPERVISOR.has(m.slug)) {
            idsBase.add(m.id);
          }
        }
      }
      efectivos = allModulos.filter((m) => idsBase.has(m.id));
    }

    const payload: Payload = {
      superAdmin: false,
      slugs: efectivos.map((m) => m.slug),
      modulos: efectivos,
    };
    writeCache(userId, payload);
    const tTotal = elapsedMs(total0);
    console.log(
      `${TIMING_TAG} resolved user=${userId.slice(0, 8)} rol=${rol} tAuth=${tAuth}ms tQueries=${tQueries}ms tEmail=${tEmail}ms tMod=${tMod}ms total=${tTotal}ms slugs=${payload.slugs.length}`
    );
    return NextResponse.json(payload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error(`${TIMING_TAG} error total=${elapsedMs(total0)}ms msg=${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

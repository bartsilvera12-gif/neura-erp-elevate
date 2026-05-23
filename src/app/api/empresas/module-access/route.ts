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
 * Optimizado para instancia single_client (Elevate) en Hostinger hPanel donde
 * cada round-trip Hostinger Paraguay → Supabase US tarda ~3.5-4s. Cualquier
 * cadena de queries secuenciales explota el tiempo total.
 *
 * Estrategia:
 *   - 1 sola resolución de auth: decode local del JWT bearer (sin round-trip
 *     a Supabase Auth). PostgREST valida la firma en cada query subsecuente.
 *   - Para usuarios normales: 1 sola query embebida con PostgREST nested select
 *     que trae usuario + usuario_modulos + empresa.empresa_modulos en 1
 *     round-trip. El catálogo se carga en paralelo (max(t1, t2) = ~4s).
 *   - Si la query embebida falla (FK ausentes en Postgres), fallback al
 *     flujo paralelo (2 batches).
 *   - Cálculo local de la intersección de módulos.
 *   - Cache in-memory por userId (TTL 60s) y catálogo cacheado 5 min.
 *   - Logs `[ma-timing]` con tiempos por etapa.
 */

const TIMING_TAG = "[ma-timing]";
const MODULE_CACHE_TTL_MS = 60_000;
const CATALOG_CACHE_TTL_MS = 5 * 60_000;

type ModuloLite = { id: string; nombre: string; slug: string };
type Payload = { superAdmin: boolean; slugs: string[]; modulos: ModuloLite[] };
type CacheEntry = { ts: number; payload: Payload };

const moduleCache = new Map<string, CacheEntry>();
let catalogCache: { ts: number; data: ModuloLite[] } | null = null;

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

function readCatalogCache(): ModuloLite[] | null {
  if (!catalogCache) return null;
  if (Date.now() - catalogCache.ts > CATALOG_CACHE_TTL_MS) {
    catalogCache = null;
    return null;
  }
  return catalogCache.data;
}

function writeCatalogCache(data: ModuloLite[]): void {
  catalogCache = { ts: Date.now(), data };
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

function decodeJwtPayloadUnsafe(token: string): { sub?: string; email?: string; exp?: number } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "===".slice(0, (4 - (b64.length % 4)) % 4);
    const json = Buffer.from(pad, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

type UsuarioEmbed = {
  id: string;
  empresa_id: string | null;
  rol: string | null;
  usuario_modulos: { modulo_id: string }[] | null;
  empresas: {
    empresa_modulos: { modulo_id: string; activo: boolean }[] | null;
  } | { empresa_modulos: { modulo_id: string; activo: boolean }[] | null }[] | null;
};

const EMBED_SELECT =
  "id,empresa_id,rol,usuario_modulos(modulo_id),empresas(empresa_modulos(modulo_id,activo))";

function extractEmpresaModulos(empresas: UsuarioEmbed["empresas"]): { modulo_id: string; activo: boolean }[] {
  if (!empresas) return [];
  // PostgREST puede devolver el embed como objeto único o como array según la FK.
  const obj = Array.isArray(empresas) ? empresas[0] : empresas;
  return obj?.empresa_modulos ?? [];
}

function computeEfectivos(
  usuario: UsuarioEmbed,
  catalogo: ModuloLite[]
): Payload {
  const rol = (usuario.rol ?? "").trim();

  if (rol === "super_admin") {
    return {
      superAdmin: true,
      slugs: catalogo.map((m) => m.slug),
      modulos: catalogo,
    };
  }

  if (!usuario.empresa_id) {
    return { superAdmin: false, slugs: [], modulos: [] };
  }

  const empresaModulosRaw = extractEmpresaModulos(usuario.empresas).filter((em) => em.activo);
  const empresaModuloIds = new Set(
    empresaModulosRaw.map((em) => String(em.modulo_id ?? "")).filter((x) => x.length > 0)
  );

  const userModuloIds = new Set(
    (usuario.usuario_modulos ?? [])
      .map((um) => String(um.modulo_id ?? ""))
      .filter((x) => x.length > 0)
  );

  const isAdminEmpresa = rol === "admin" || rol === "administrador";
  const isSupervisor = isErpRolSupervisor(rol);

  let effectiveIds: Set<string>;
  if (isAdminEmpresa) {
    effectiveIds = empresaModuloIds;
  } else {
    effectiveIds =
      userModuloIds.size === 0
        ? new Set(empresaModuloIds)
        : new Set([...userModuloIds].filter((id) => empresaModuloIds.has(id)));

    if (isSupervisor) {
      for (const m of catalogo) {
        if (empresaModuloIds.has(m.id) && SLUGS_OMNICANAL_SUPERVISOR.has(m.slug)) {
          effectiveIds.add(m.id);
        }
      }
    }
  }

  const efectivos = catalogo.filter((m) => effectiveIds.has(m.id));
  return {
    superAdmin: false,
    slugs: efectivos.map((m) => m.slug),
    modulos: efectivos,
  };
}

async function loadCatalogo(userScoped: AppSupabaseClient): Promise<ModuloLite[]> {
  const cached = readCatalogCache();
  if (cached) return cached;
  const { data } = await userScoped.from("modulos").select("id,nombre,slug").order("slug");
  const out = ((data as ModuloLite[] | null) ?? []).filter((m) => m.slug);
  if (out.length > 0) writeCatalogCache(out);
  return out;
}

/**
 * Fallback al flujo paralelo (2 batches) cuando el embed falla por FK ausentes.
 * Mantiene el comportamiento previo a la optimización por embed.
 */
async function fallbackParallel(
  userScoped: AppSupabaseClient,
  userId: string,
  userEmail: string | null,
  catalogo: ModuloLite[]
): Promise<{ usuario: UsuarioEmbed | null; tEmail: number }> {
  // Resolver usuario (por id, luego por email).
  const { data: byId } = await userScoped
    .from("usuarios")
    .select("id, empresa_id, rol")
    .eq("auth_user_id", userId)
    .limit(1);
  let row = ((byId as { id: string; empresa_id: string | null; rol: string | null }[] | null) ?? [])[0] ?? null;
  let tEmail = 0;
  if (!row && userEmail) {
    const tE0 = performance.now();
    const { data: byEmail } = await userScoped
      .from("usuarios")
      .select("id, empresa_id, rol")
      .ilike("email", userEmail)
      .limit(1);
    tEmail = elapsedMs(tE0);
    row = ((byEmail as { id: string; empresa_id: string | null; rol: string | null }[] | null) ?? [])[0] ?? null;
  }
  if (!row) return { usuario: null, tEmail };

  // Si tiene empresa: traer empresa_modulos + usuario_modulos en paralelo.
  let empresa_modulos: { modulo_id: string; activo: boolean }[] = [];
  let usuario_modulos: { modulo_id: string }[] = [];
  if (row.empresa_id) {
    const [emR, umR] = await Promise.all([
      userScoped
        .from("empresa_modulos")
        .select("modulo_id, activo")
        .eq("empresa_id", row.empresa_id)
        .eq("activo", true),
      userScoped.from("usuario_modulos").select("modulo_id").eq("usuario_id", row.id),
    ]);
    empresa_modulos = ((emR.data as { modulo_id: string; activo: boolean }[] | null) ?? []);
    usuario_modulos = ((umR.data as { modulo_id: string }[] | null) ?? []);
  }

  // Silenciamos catalogo aquí; ya viene del caller.
  void catalogo;

  return {
    usuario: {
      id: row.id,
      empresa_id: row.empresa_id,
      rol: row.rol,
      usuario_modulos,
      empresas: { empresa_modulos },
    },
    tEmail,
  };
}

export async function GET(request: Request) {
  const total0 = performance.now();
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !anonKey) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    // ── 1) Auth: decode JWT local (bearer) o cookies ─────────────────────
    const tAuth0 = performance.now();
    const bearer = extractBearer(request);
    let userId: string;
    let userEmail: string | null;
    let userScoped: AppSupabaseClient;

    if (bearer) {
      const payload = decodeJwtPayloadUnsafe(bearer);
      const sub = payload?.sub;
      const exp = payload?.exp;
      if (!sub || (exp && exp * 1000 < Date.now())) {
        return NextResponse.json({ error: "No autenticado" }, { status: 401 });
      }
      userId = sub;
      userEmail = payload?.email ?? null;
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

    // ── 3) Bootstrap super_admin: 1 query catálogo + return ────────────
    if (isBootstrapSuperAdminEmail(userEmail)) {
      const tCat0 = performance.now();
      const catalogo = await loadCatalogo(userScoped);
      const tCat = elapsedMs(tCat0);
      const payload: Payload = {
        superAdmin: true,
        slugs: catalogo.map((m) => m.slug),
        modulos: catalogo,
      };
      writeCache(userId, payload);
      console.log(
        `${TIMING_TAG} bootstrap user=${userId.slice(0, 8)} tAuth=${tAuth}ms tCat=${tCat}ms total=${elapsedMs(total0)}ms`
      );
      return NextResponse.json(payload);
    }

    // ── 4) Query embebida + catálogo en PARALELO (1 round-trip efectivo) ─
    const tQ0 = performance.now();
    const [catalogo, embedResult] = await Promise.all([
      loadCatalogo(userScoped),
      userScoped
        .from("usuarios")
        .select(EMBED_SELECT)
        .eq("auth_user_id", userId)
        .limit(1)
        .maybeSingle(),
    ]);
    const tQuery = elapsedMs(tQ0);

    let usuario: UsuarioEmbed | null = null;
    let tEmail = 0;
    let usedFallback = false;

    if (embedResult.error) {
      // FK ausentes u otro error estructural → fallback paralelo.
      console.warn(
        `${TIMING_TAG} embed_failed: ${embedResult.error.message}; falling back to parallel`
      );
      const fb = await fallbackParallel(userScoped, userId, userEmail, catalogo);
      usuario = fb.usuario;
      tEmail = fb.tEmail;
      usedFallback = true;
    } else {
      usuario = (embedResult.data as UsuarioEmbed | null) ?? null;
      // Fallback por email solo si no se encontró por auth_user_id.
      if (!usuario && userEmail) {
        const tE0 = performance.now();
        const { data: byEmail } = await userScoped
          .from("usuarios")
          .select(EMBED_SELECT)
          .ilike("email", userEmail)
          .limit(1)
          .maybeSingle();
        tEmail = elapsedMs(tE0);
        usuario = (byEmail as UsuarioEmbed | null) ?? null;
      }
    }

    if (!usuario) {
      const payload: Payload = { superAdmin: false, slugs: [], modulos: [] };
      console.log(
        `${TIMING_TAG} no_usuario user=${userId.slice(0, 8)} tAuth=${tAuth}ms tQuery=${tQuery}ms tEmail=${tEmail}ms total=${elapsedMs(total0)}ms fallback=${usedFallback}`
      );
      return NextResponse.json(payload);
    }

    const payload = computeEfectivos(usuario, catalogo);
    writeCache(userId, payload);
    const total = elapsedMs(total0);
    console.log(
      `${TIMING_TAG} resolved user=${userId.slice(0, 8)} rol=${(usuario.rol ?? "").trim()} tAuth=${tAuth}ms tQuery=${tQuery}ms tEmail=${tEmail}ms total=${total}ms slugs=${payload.slugs.length} fallback=${usedFallback}`
    );
    return NextResponse.json(payload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    console.error(`${TIMING_TAG} error total=${elapsedMs(total0)}ms msg=${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

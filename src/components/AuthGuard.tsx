"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getCurrentUser, getSession } from "@/lib/auth";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import {
  firstAccessibleHref,
  isModuleSlugGranted,
  pathRequiresModuleSlug,
} from "@/lib/modulos/route-slug-map";
import { ZentraLoadingScreen } from "@/components/ui/ZentraLoadingScreen";

const PUBLIC_ROUTES = ["/login"];

type ModuleAccess = { superAdmin: boolean; slugs: Set<string> };

/**
 * Cache cliente del resultado de /api/empresas/module-access. El endpoint puede
 * tardar varios segundos por la resolución de auth en Hostinger; cachear el
 * snapshot en sessionStorage permite que la carga CALIENTE (refresh, nav entre
 * pestañas, F5) sea instantánea y se revalide en segundo plano.
 *
 * TTL conservador: si un admin cambia los permisos, el usuario los ve tras la
 * revalidación en background o al cerrar sesión.
 */
const MODULE_ACCESS_CACHE_KEY = "neura.moduleAccess.v1";
const MODULE_ACCESS_TTL_MS = 10 * 60 * 1000;

type CachedAccess = {
  ts: number;
  userId: string;
  superAdmin: boolean;
  slugs: string[];
};

function readCachedAccess(userId: string): { superAdmin: boolean; slugs: string[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(MODULE_ACCESS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAccess;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.userId !== userId) return null;
    if (Date.now() - parsed.ts > MODULE_ACCESS_TTL_MS) return null;
    return { superAdmin: !!parsed.superAdmin, slugs: Array.isArray(parsed.slugs) ? parsed.slugs : [] };
  } catch {
    return null;
  }
}

function writeCachedAccess(userId: string, superAdmin: boolean, slugs: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedAccess = { ts: Date.now(), userId, superAdmin, slugs };
    window.sessionStorage.setItem(MODULE_ACCESS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* sessionStorage no disponible: no es bloqueante */
  }
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<ModuleAccess | null>(null);

  const isPublic = useMemo(
    () => !!(pathname && PUBLIC_ROUTES.includes(pathname)),
    [pathname]
  );

  useEffect(() => {
    if (isPublic) {
      setLoading(false);
      setAccess(null);
      return;
    }

    let cancelled = false;

    async function checkAuthAndModules() {
      const session = await getSession();
      if (cancelled) return;
      if (!session) {
        router.push("/login");
        setLoading(false);
        return;
      }

      const userId = session.user.id;
      const cached = readCachedAccess(userId);
      if (cached) {
        setAccess({ superAdmin: cached.superAdmin, slugs: new Set(cached.slugs) });
        setLoading(false);
      } else {
        setLoading(true);
      }

      const res = await fetchWithSupabaseSession("/api/empresas/module-access", {
        cache: "no-store",
      });
      if (cancelled) return;

      let superAdmin = false;
      let slugs: string[] = [];

      const bootstrapSuper = isBootstrapSuperAdminEmail(session.user.email ?? null);

      if (res.ok) {
        const data = (await res.json()) as { superAdmin?: boolean; slugs?: string[] };
        superAdmin = !!data.superAdmin || bootstrapSuper;
        slugs = Array.isArray(data.slugs) ? data.slugs : [];
      } else {
        superAdmin = bootstrapSuper;
      }

      if (!superAdmin) {
        try {
          const cu = await getCurrentUser();
          if ((cu?.rol ?? "").trim() === "super_admin") superAdmin = true;
        } catch {
          /* sin fila usuarios en cliente */
        }
      }

      writeCachedAccess(userId, superAdmin, slugs);
      setAccess({
        superAdmin,
        slugs: new Set(slugs),
      });
      setLoading(false);
    }

    checkAuthAndModules();
    return () => {
      cancelled = true;
    };
  }, [isPublic, router]);

  useEffect(() => {
    if (loading || isPublic || !access || !pathname) return;

    if (pathname.startsWith("/admin") && !access.superAdmin) {
      router.replace(firstAccessibleHref(access.slugs, { superAdmin: false }));
      return;
    }

    const slug = pathRequiresModuleSlug(pathname);
    if (slug && !access.superAdmin && !isModuleSlugGranted(slug, access.slugs)) {
      const dest = firstAccessibleHref(access.slugs, { superAdmin: access.superAdmin });
      if (dest !== pathname.split("?")[0]) router.replace(dest);
    }
  }, [pathname, access, loading, isPublic, router]);

  if (loading && !isPublic) {
    return <ZentraLoadingScreen />;
  }

  return <>{children}</>;
}

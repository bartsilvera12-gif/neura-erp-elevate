import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * GET /api/debug/runtime
 *
 * Diagnóstico runtime SEGURO — sin secretos, sin tokens, sin cookies.
 * Devuelve presencia/longitud/hash12/jwt.role de las env vars críticas
 * para identificar si Hostinger hPanel tiene la config correcta.
 *
 * Endpoint público de solo lectura. Borrar cuando el deploy esté estable.
 */
export const dynamic = "force-dynamic";

function hash12(v: string | undefined | null): string {
  if (!v) return "<empty>";
  return crypto.createHash("sha256").update(v).digest("hex").slice(0, 12);
}

function jwtRole(t: string | undefined | null): string {
  if (!t || !t.startsWith("ey")) return "<not-jwt>";
  try {
    const parts = t.split(".");
    if (parts.length !== 3) return "<not-jwt>";
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    return String(payload.role ?? "<no-role>");
  } catch {
    return "<decode-err>";
  }
}

function summarizeSecret(v: string | undefined | null) {
  return {
    present: !!v,
    len: v?.length ?? 0,
    sha256_12: hash12(v),
    jwt_role: jwtRole(v),
  };
}

function readBuildInfo(): { commit: string; short: string; builtAt: string } | { error: string } {
  try {
    const p = path.join(process.cwd(), "build-info.json");
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const sr = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";

  return NextResponse.json({
    build: readBuildInfo(),
    node: {
      version: process.version,
      platform: process.platform,
      uptimeSec: Math.round(process.uptime()),
    },
    env: {
      NODE_ENV: process.env.NODE_ENV ?? "<unset>",
      NEURA_CLIENT_SCHEMA: process.env.NEURA_CLIENT_SCHEMA?.trim() ?? "<unset>",
      NEURA_INSTANCE_MODE: process.env.NEURA_INSTANCE_MODE?.trim() ?? "<unset>",
      NEURA_CLIENT_NAME: process.env.NEURA_CLIENT_NAME?.trim() ?? "<unset>",
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl || "<empty>",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: summarizeSecret(anon),
      SUPABASE_SERVICE_ROLE_KEY: summarizeSecret(sr),
      sr_eq_anon: !!(sr && anon && sr === anon),
    },
  });
}

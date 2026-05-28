/**
 * Videos de reseñas Elevate — listado y carga.
 *
 *   GET  /api/resenas-videos       — lista videos de la empresa (todos, no solo visibles)
 *   POST /api/resenas-videos       — sube nuevo video (formdata `file`, `titulo?`, `descripcion?`)
 *
 * Auth: JWT del usuario. RLS de elevate.resenas_videos cubre el aislamiento.
 * Storage: bucket público `resenas-videos` con JWT del usuario (mismo patrón
 *   que el endpoint de imágenes de producto).
 *
 * Límite: máximo 4 videos activos+visibles por empresa (trigger en DB).
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import {
  getAccessTokenForRequest,
  postgrestGet,
  postgrestRequest,
} from "@/lib/supabase/postgrest-runtime";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_VIDEO_MIME,
  MAX_VIDEO_BYTES,
  MAX_VIDEOS_VISIBLES,
  RESENAS_VIDEOS_BUCKET,
  buildResenaVideoPath,
  publicResenaVideoUrl,
} from "@/lib/resenas/storage";

const SELECT_COLS =
  "id,titulo,descripcion,video_path,video_url,poster_path,poster_url,orden,visible_web,activo,created_at,updated_at";

type ResenaRow = {
  id: string;
  titulo: string | null;
  descripcion: string | null;
  video_path: string;
  video_url: string;
  poster_path: string | null;
  poster_url: string | null;
  orden: number;
  visible_web: boolean;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

function storageClientWithJwt(jwt: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL/ANON_KEY");
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : undefined,
  });
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx)
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const jwt = await getAccessTokenForRequest(request);
    const qs = new URLSearchParams({
      select: SELECT_COLS,
      empresa_id: `eq.${ctx.auth.empresa_id}`,
      order: "orden.asc,created_at.asc",
      limit: "20",
    });
    const r = await postgrestGet<ResenaRow>("resenas_videos", qs.toString(), {
      role: "jwt",
      jwt,
      noStore: true,
    });
    if (!r.ok) {
      console.error("[/api/resenas-videos GET]", r.error);
      return NextResponse.json(errorResponse("No se pudieron cargar las reseñas."), {
        status: 502,
      });
    }
    return NextResponse.json(
      successResponse({ videos: r.rows, max: MAX_VIDEOS_VISIBLES })
    );
  } catch (err) {
    console.error("[/api/resenas-videos GET] outer", err);
    return NextResponse.json(errorResponse("No se pudieron cargar las reseñas."), {
      status: 500,
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx)
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const jwt = await getAccessTokenForRequest(request);

    // 1) Gate temprano: contar visibles+activos antes de leer bytes.
    const qsCount = new URLSearchParams({
      select: "id",
      empresa_id: `eq.${empresaId}`,
      activo: "eq.true",
      visible_web: "eq.true",
    });
    const rCount = await postgrestGet<{ id: string }>(
      "resenas_videos",
      qsCount.toString(),
      { role: "jwt", jwt, noStore: true }
    );
    if (!rCount.ok) {
      return NextResponse.json(errorResponse("No se pudo verificar el contador."), {
        status: 502,
      });
    }
    if (rCount.rows.length >= MAX_VIDEOS_VISIBLES) {
      return NextResponse.json(
        errorResponse(
          `Ya alcanzaste el máximo de ${MAX_VIDEOS_VISIBLES} videos. Eliminá uno para cargar otro.`
        ),
        { status: 409 }
      );
    }

    // 2) Validar archivo
    const form = await request.formData();
    const file = form.get("file");
    const titulo = (form.get("titulo") ?? "").toString().trim() || null;
    const descripcion = (form.get("descripcion") ?? "").toString().trim() || null;
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), {
        status: 400,
      });
    }
    if (!ALLOWED_VIDEO_MIME.has(file.type)) {
      return NextResponse.json(
        errorResponse(
          "Formato no permitido. Usá MP4 (recomendado), WebM o MOV."
        ),
        { status: 400 }
      );
    }
    if (file.size > MAX_VIDEO_BYTES) {
      const mb = (MAX_VIDEO_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(errorResponse(`Video demasiado grande (máx. ${mb} MB).`), {
        status: 413,
      });
    }

    // 3) Pre-generar id para path estable
    const videoId = (globalThis.crypto?.randomUUID?.() ?? "") || cryptoFallback();
    const path = buildResenaVideoPath(empresaId, videoId, file.type);
    const storage = storageClientWithJwt(jwt);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await storage.storage
      .from(RESENAS_VIDEOS_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: false });
    if (up.error) {
      console.error("[/api/resenas-videos POST] upload", up.error.message);
      return NextResponse.json(
        errorResponse(
          `No se pudo subir el video. (storage_upload_failed · ${up.error.message.slice(0, 120)})`
        ),
        { status: 502 }
      );
    }
    const publicUrl = publicResenaVideoUrl(path) ?? "";

    // 4) Orden = primer slot 0..3 libre entre los videos visibles+activos.
    const qsOrden = new URLSearchParams({
      select: "orden",
      empresa_id: `eq.${empresaId}`,
      activo: "eq.true",
      visible_web: "eq.true",
    });
    const rOrden = await postgrestGet<{ orden: number }>(
      "resenas_videos",
      qsOrden.toString(),
      { role: "jwt", jwt, noStore: true }
    );
    const ordenes = new Set((rOrden.ok ? rOrden.rows : []).map((r) => r.orden));
    let orden = 0;
    for (let i = 0; i < MAX_VIDEOS_VISIBLES; i++) {
      if (!ordenes.has(i)) {
        orden = i;
        break;
      }
    }

    // 5) Insert
    const insertBody = {
      id: videoId,
      empresa_id: empresaId,
      titulo,
      descripcion,
      video_path: path,
      video_url: publicUrl,
      orden,
      visible_web: true,
      activo: true,
    };
    const r = await postgrestRequest<ResenaRow>("resenas_videos", `select=${SELECT_COLS}`, {
      method: "POST",
      role: "jwt",
      jwt,
      body: insertBody,
      prefer: "return=representation",
    });
    if (!r.ok) {
      // Limpiar storage best-effort
      try {
        await storage.storage.from(RESENAS_VIDEOS_BUCKET).remove([path]);
      } catch {
        // best-effort
      }
      console.error("[/api/resenas-videos POST] insert", r.error);
      return NextResponse.json(
        errorResponse(
          `No se pudo registrar el video. (${(r.error.message ?? "").slice(0, 160)})`
        ),
        { status: 502 }
      );
    }
    return NextResponse.json(successResponse({ video: r.rows[0] }), { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    console.error("[/api/resenas-videos POST] outer", err);
    return NextResponse.json(
      errorResponse(`No se pudo subir el video. (${msg.slice(0, 200)})`),
      { status: 500 }
    );
  }
}

function cryptoFallback(): string {
  // Solo fallback defensivo — en runtime moderno crypto.randomUUID existe.
  const a = Math.random().toString(16).slice(2, 10);
  const b = Math.random().toString(16).slice(2, 6);
  const c = Math.random().toString(16).slice(2, 6);
  const d = Math.random().toString(16).slice(2, 6);
  const e = Math.random().toString(16).slice(2, 14);
  return `${a}-${b}-${c}-${d}-${e}`;
}

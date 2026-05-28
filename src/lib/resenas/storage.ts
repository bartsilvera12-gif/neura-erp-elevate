/**
 * Storage helpers para videos de reseñas Elevate.
 *
 * Bucket: `resenas-videos` (público).
 * Path:   `{empresa_id}/{video_id}/video.{ext}`
 *
 * Aislamiento por tenant: el primer segmento del path es `empresa_id` y los
 * endpoints siempre validan el `empresa_id` del usuario antes de leer/escribir.
 */

export const RESENAS_VIDEOS_BUCKET = "resenas-videos";

export const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/webm"]);
export const ALLOWED_VIDEO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

export const MAX_VIDEOS_VISIBLES = 4;

export function buildResenaVideoPath(
  empresaId: string,
  videoId: string,
  mime: string
): string {
  const ext = ALLOWED_VIDEO_EXT[mime] ?? "bin";
  return `${empresaId}/${videoId}/video.${ext}`;
}

/**
 * URL pública directa al objeto del bucket. Requiere bucket público.
 * Devuelve null si falta config.
 */
export function publicResenaVideoUrl(
  videoPath: string | null | undefined
): string | null {
  if (!videoPath) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!base) return null;
  const clean = base.replace(/\/$/, "");
  const encoded = videoPath.split("/").map(encodeURIComponent).join("/");
  return `${clean}/storage/v1/object/public/${RESENAS_VIDEOS_BUCKET}/${encoded}`;
}

/**
 * Valida que el path corresponde a un objeto gestionado por nosotros para la
 * empresa indicada: primer segmento = empresa_id, no es URL externa, no es
 * asset estático.
 */
export function isManagedResenaPath(
  path: string | null | undefined,
  empresaId: string
): boolean {
  if (!path) return false;
  if (/^https?:\/\//i.test(path)) return false;
  if (path.startsWith("/")) return false;
  const parts = path.split("/").filter((s) => s.length > 0);
  if (parts.length < 3) return false;
  return parts[0] === empresaId;
}

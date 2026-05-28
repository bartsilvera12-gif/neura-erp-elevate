"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Trash2, Upload, AlertCircle } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { supabase } from "@/lib/supabase";
import * as tus from "tus-js-client";

const BUCKET = "resenas-videos";
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/**
 * Upload por chunks (TUS resumable). 6 MB es el tamaño recomendado por
 * Supabase Storage para el endpoint /storage/v1/upload/resumable. Cada chunk
 * es una request independiente, así que cualquier proxy intermedio
 * (Cloudflare, Traefik) no corta el upload de archivos grandes.
 */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

async function uploadViaTus(opts: {
  file: File;
  path: string;
  contentType: string;
  jwt: string;
  onProgress: (pct: number) => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(opts.file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${opts.jwt}`,
        apikey: SUPABASE_ANON,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: BUCKET,
        objectName: opts.path,
        contentType: opts.contentType,
        cacheControl: "3600",
      },
      chunkSize: TUS_CHUNK_SIZE,
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (sent, total) => {
        if (total > 0) opts.onProgress(Math.floor((sent / total) * 100));
      },
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

function extFor(file: File): string {
  if (file.type === "video/mp4") return "mp4";
  if (file.type === "video/webm") return "webm";
  if (file.type === "video/quicktime") return "mov";
  // Fallback por extensión del nombre.
  const m = /\.([a-z0-9]+)$/i.exec(file.name);
  return (m?.[1] ?? "mp4").toLowerCase();
}

type ResenaVideo = {
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

const MAX_VIDEOS = 4;
const MAX_BYTES = 200 * 1024 * 1024;
const ACCEPT_ATTR = "video/mp4,video/webm,video/quicktime,.mov";
const MIME_RE = /^video\/(mp4|webm|quicktime)$/i;

export default function ResenasClient() {
  const [videos, setVideos] = useState<ResenaVideo[]>([]);
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchWithSupabaseSession("/api/resenas-videos", { cache: "no-store" });
      const body = (await r.json()) as
        | {
            success: true;
            data: {
              videos: ResenaVideo[];
              max: number;
              empresa_id: string;
              bucket: string;
            };
          }
        | { success: false; error: string };
      if (!r.ok || !("success" in body) || body.success === false) {
        setError(("success" in body && body.success === false ? body.error : null) || "No se pudo cargar.");
        setVideos([]);
        return;
      }
      setVideos(body.data.videos);
      setEmpresaId(body.data.empresa_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return;
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setError("Seleccioná un video primero.");
      return;
    }
    if (!empresaId) {
      setError("No se pudo resolver tu empresa. Recargá la página.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`El video supera el máximo de ${(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.`);
      return;
    }
    // Algunos browsers no setean file.type para .mov; aceptar por extensión.
    const looksMov = /\.mov$/i.test(f.name);
    const fileType = f.type || (looksMov ? "video/quicktime" : "");
    if (!MIME_RE.test(fileType)) {
      setError("Formato no permitido. Usá MP4 (recomendado), WebM o MOV.");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    setError(null);
    try {
      // 1) Resolver JWT del usuario para autenticar el upload TUS.
      const sess = await supabase.auth.getSession();
      const jwt = sess.data.session?.access_token;
      if (!jwt) {
        setError("Tu sesión expiró. Recargá la página e ingresá de nuevo.");
        return;
      }
      // 2) Upload por chunks (TUS resumable) directo a Supabase Storage.
      //    Saltea Next.js, Coolify Traefik y cualquier corte de tamaño en
      //    proxies upstream (Cloudflare) que rompía single-POST grandes.
      const videoId = (globalThis.crypto?.randomUUID?.() ?? "") ||
        `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      const ext = extFor(f);
      const path = `${empresaId}/${videoId}/video.${ext}`;
      try {
        await uploadViaTus({
          file: f,
          path,
          contentType: fileType,
          jwt,
          onProgress: (pct) => setUploadPct(pct),
        });
      } catch (e) {
        setError(
          `No se pudo subir el video. (${e instanceof Error ? e.message : String(e)})`
        );
        return;
      }
      setUploadPct(100);
      // 2) Registrar metadata via API (JSON, sin archivo).
      const r = await fetchWithSupabaseSession("/api/resenas-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: path,
          mime: fileType,
          titulo: titulo.trim() || undefined,
        }),
      });
      const body = (await r.json()) as
        | { success: true; data: { video: ResenaVideo } }
        | { success: false; error: string };
      if (!r.ok || !("success" in body) || body.success === false) {
        // Si la API falla, intentar limpiar el objeto storage.
        try {
          await supabase.storage.from(BUCKET).remove([path]);
        } catch {
          /* best-effort */
        }
        setError(("success" in body && body.success === false ? body.error : null) || "No se pudo registrar el video.");
        return;
      }
      setVideos((prev) => [...prev, body.data.video].sort((a, b) => a.orden - b.orden));
      setTitulo("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setUploading(false);
      setUploadPct(null);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("¿Eliminar este video de reseña? Esta acción no se puede deshacer.")) return;
    setError(null);
    try {
      const r = await fetchWithSupabaseSession(`/api/resenas-videos/${id}`, {
        method: "DELETE",
      });
      const body = (await r.json()) as
        | { success: true; data: { ok: true } }
        | { success: false; error: string };
      if (!r.ok || !("success" in body) || body.success === false) {
        setError(("success" in body && body.success === false ? body.error : null) || "No se pudo eliminar.");
        return;
      }
      setVideos((prev) => prev.filter((v) => v.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    }
  };

  const visiblesActivos = videos.filter((v) => v.activo && v.visible_web).length;
  const lleno = visiblesActivos >= MAX_VIDEOS;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center gap-3">
        <Clapperboard className="h-6 w-6 text-amber-500" />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Videos de reseñas
          </h1>
          <p className="text-sm text-slate-500">
            Hasta {MAX_VIDEOS} videos para mostrar en la home pública.{" "}
            <span className="font-medium">
              {visiblesActivos}/{MAX_VIDEOS} cargados
            </span>
          </p>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="mb-8 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Subir nuevo video
        </h2>
        {lleno ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Ya alcanzaste el máximo de {MAX_VIDEOS} videos. Eliminá uno para cargar otro.
          </p>
        ) : (
          <form onSubmit={onUpload} className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Título (opcional)"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 dark:border-slate-600 dark:bg-slate-800"
              />
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT_ATTR}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-amber-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-amber-600 dark:text-slate-300"
              />
              <p className="text-xs text-slate-500">
                MP4 (recomendado), WebM o MOV — máximo{" "}
                {(MAX_BYTES / 1024 / 1024).toFixed(0)} MB.
              </p>
              <p className="text-xs text-slate-400">
                Tip: los MOV se ven bien en Safari/iPhone, pero algunos
                navegadores (Firefox y ciertos Chrome) pueden no reproducirlos.
                Si querés máxima compatibilidad en la web pública, usá MP4.
              </p>
            </div>
            <button
              type="submit"
              disabled={uploading}
              className="inline-flex h-fit items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-600"
            >
              <Upload className="h-4 w-4" />
              {uploading
                ? uploadPct != null && uploadPct < 100
                  ? `Subiendo… ${uploadPct}%`
                  : "Subiendo…"
                : "Subir video"}
            </button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Videos cargados
        </h2>
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : videos.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aún no hay videos cargados. La home mostrará un fallback hasta que subas al menos uno.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {videos.map((v) => (
              <div
                key={v.id}
                className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="relative aspect-video bg-black">
                  <video
                    src={v.video_url}
                    controls
                    preload="metadata"
                    playsInline
                    className="h-full w-full"
                  />
                </div>
                <div className="p-3">
                  <p
                    className="truncate text-sm font-medium text-slate-900 dark:text-slate-100"
                    title={v.titulo ?? ""}
                  >
                    {v.titulo || <span className="italic text-slate-400">Sin título</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">Orden {v.orden + 1}</p>
                  <button
                    onClick={() => onDelete(v.id)}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

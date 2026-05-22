import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { getAccessTokenForRequest } from "@/lib/supabase/postgrest-runtime";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import {
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
  PRODUCTOS_IMAGENES_BUCKET,
  buildProductoImagenPath,
  ensureProductosImagenesBucket,
  pathBelongsToEmpresa,
  signProductoImagen,
} from "@/lib/inventario/imagen-storage";
import {
  getProductoPostgrest,
  updateProductoPostgrest,
} from "@/lib/inventario/server/productos-postgrest";

/**
 * Imagen de producto (bucket privado `productos-imagenes`).
 *
 * Productos: PostgREST HTTPS con JWT del usuario (RLS por empresa). El
 * runtime Hostinger NO puede usar pg.Pool (puerto 5432 firewalled).
 * Storage: SDK Supabase con service role (necesario para subir a bucket
 * privado y para crear el bucket si no existe).
 */

function diagnostic(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" · ");
}

export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;
    const jwt = await getAccessTokenForRequest(request);

    const prod = await getProductoPostgrest(jwt, empresaId, productoId);
    if (!prod) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }
    const signed = prod.imagen_path
      ? await signProductoImagen(supabase, prod.imagen_path, 3600)
      : null;
    return NextResponse.json(
      successResponse({ imagen_path: prod.imagen_path, imagen_url: signed })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/productos/[id]/imagen GET]", msg);
    return NextResponse.json(
      errorResponse(`No se pudo obtener la imagen. (${msg.slice(0, 160)})`),
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;
    const jwt = await getAccessTokenForRequest(request);

    // 1) Ownership via PostgREST (RLS por empresa).
    let prod;
    try {
      prod = await getProductoPostgrest(jwt, empresaId, productoId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[/api/productos/[id]/imagen POST] ownership", msg);
      return NextResponse.json(
        errorResponse(`No se pudo subir la imagen. (ownership_check_failed · ${msg.slice(0, 120)})`),
        { status: 502 }
      );
    }
    if (!prod) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }

    // 2) Leer archivo
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(errorResponse("Falta el archivo (campo 'file')."), { status: 400 });
    }
    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      return NextResponse.json(
        errorResponse("Formato no permitido. Usá JPG, PNG o WebP."),
        { status: 400 }
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
      return NextResponse.json(
        errorResponse(`Imagen demasiado grande (máx. ${mb} MB).`),
        { status: 413 }
      );
    }

    // 3) Bucket idempotente (no-op si ya existe)
    try {
      await ensureProductosImagenesBucket(supabase);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[/api/productos/[id]/imagen POST] bucket", msg);
      return NextResponse.json(
        errorResponse(`No se pudo subir la imagen. (storage_bucket_setup_failed · ${msg.slice(0, 120)})`),
        { status: 502 }
      );
    }

    // 4) Borrar imagen anterior si pertenece a la empresa
    if (prod.imagen_path && pathBelongsToEmpresa(prod.imagen_path, empresaId)) {
      await supabase.storage.from(PRODUCTOS_IMAGENES_BUCKET).remove([prod.imagen_path]);
    }

    // 5) Upload nuevo
    const path = buildProductoImagenPath(empresaId, productoId, file.type);
    const buf = Buffer.from(await file.arrayBuffer());
    const up = await supabase.storage
      .from(PRODUCTOS_IMAGENES_BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });
    if (up.error) {
      console.error("[/api/productos/[id]/imagen POST] upload", { empresaId, productoId, message: up.error.message });
      return NextResponse.json(
        errorResponse(`No se pudo subir la imagen. (storage_upload_failed · ${up.error.message.slice(0, 120)})`),
        { status: 502 }
      );
    }

    // 6) Persistir imagen_path via PostgREST
    let updated;
    try {
      updated = await updateProductoPostgrest(jwt, empresaId, productoId, {
        imagen_path: path,
        imagen_url: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[/api/productos/[id]/imagen POST] persist", msg);
      return NextResponse.json(
        errorResponse(`No se pudo asociar la imagen al producto. (db_update_failed · ${msg.slice(0, 120)})`),
        { status: 502 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        errorResponse("No se pudo asociar la imagen al producto."),
        { status: 500 }
      );
    }

    // 7) Signed URL para preview
    const signed = await signProductoImagen(supabase, path, 3600);
    return NextResponse.json(successResponse({ imagen_path: path, imagen_url: signed }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/productos/[id]/imagen POST] outer", msg);
    return NextResponse.json(
      errorResponse(`No se pudo subir la imagen. (${diagnostic([msg.slice(0, 160)])})`),
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id: productoId } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const { supabase, auth } = ctx;
    const empresaId = auth.empresa_id;
    const jwt = await getAccessTokenForRequest(request);

    const prod = await getProductoPostgrest(jwt, empresaId, productoId);
    if (!prod) {
      return NextResponse.json(errorResponse(API_ERRORS.NOT_FOUND), { status: 404 });
    }

    if (prod.imagen_path && pathBelongsToEmpresa(prod.imagen_path, empresaId)) {
      await supabase.storage.from(PRODUCTOS_IMAGENES_BUCKET).remove([prod.imagen_path]);
    }

    await updateProductoPostgrest(jwt, empresaId, productoId, {
      imagen_path: null,
      imagen_url: null,
    });

    return NextResponse.json(successResponse({ imagen_path: null, imagen_url: null }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/productos/[id]/imagen DELETE]", msg);
    return NextResponse.json(
      errorResponse(`No se pudo quitar la imagen. (${msg.slice(0, 160)})`),
      { status: 500 }
    );
  }
}

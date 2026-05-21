"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MontoInput from "@/components/ui/MontoInput";
import SelectFromList from "@/components/inventario/SelectFromList";
import { productoExiste, saveProducto } from "@/lib/inventario/storage";
import type { MetodoValuacion } from "@/lib/inventario/types";
import {
  CatalogoWebFields,
  catalogoWebToPayload,
  emptyCatalogoWeb,
  type CatalogoWebState,
} from "@/components/inventario/CatalogoWebFields";
import { slugifyNombre } from "@/lib/inventario/slug";

interface CatRow { id: string; nombre: string }
interface UbiRow { id: string; nombre: string; tipo: string }
interface ProvRow { id: string; nombre: string }

export default function NuevoProductoPage() {
  const router = useRouter();
  const [errorDuplicado, setErrorDuplicado] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const [form, setForm] = useState({
    nombre: "",
    sku: "",
    codigo_barras: "",
    costo_promedio: "",
    markup: "",
    precio_venta: "",
    stock_actual: "",
    stock_minimo: "",
    unidad_medida: "",
    metodo_valuacion: "CPP" as MetodoValuacion,
  });
  const [submitting, setSubmitting] = useState(false);
  const [generandoCodigo, setGenerandoCodigo] = useState(false);
  const [codigoGeneradoInterno, setCodigoGeneradoInterno] = useState(false);

  // Catálogo web (Fase 1 catálogo enriquecido)
  const [catWeb, setCatWeb] = useState<CatalogoWebState>(emptyCatalogoWeb);

  // Relaciones opcionales
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [ubicacionId, setUbicacionId] = useState<string | null>(null);
  const [proveedorId, setProveedorId] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<CatRow[]>([]);
  const [ubicaciones, setUbicaciones] = useState<UbiRow[]>([]);
  const [proveedores, setProveedores] = useState<ProvRow[]>([]);

  useEffect(() => {
    let cancel = false;
    async function load(url: string) {
      try {
        const r = await fetch(url, { credentials: "include" });
        const j = await r.json();
        return r.ok && j?.success ? j.data : null;
      } catch { return null; }
    }
    (async () => {
      const [cats, ubis, provs] = await Promise.all([
        load("/api/inventario/categorias"),
        load("/api/inventario/ubicaciones"),
        load("/api/proveedores"),
      ]);
      if (cancel) return;
      if (cats?.categorias) setCategorias(cats.categorias as CatRow[]);
      if (ubis?.ubicaciones) setUbicaciones(ubis.ubicaciones as UbiRow[]);
      if (provs?.proveedores) setProveedores(provs.proveedores as ProvRow[]);
    })();
    return () => { cancel = true; };
  }, []);

  // Imagen pendiente de subir (se sube luego de crear el producto, con su ID).
  const [imagenFile, setImagenFile] = useState<File | null>(null);
  const [imagenPreview, setImagenPreview] = useState<string | null>(null);
  const [imagenError, setImagenError] = useState<string | null>(null);

  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
  const MAX_IMG_BYTES = 5 * 1024 * 1024;

  function handleImagenChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImagenError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setImagenFile(null);
      setImagenPreview(null);
      return;
    }
    if (!ALLOWED_MIME.includes(f.type)) {
      setImagenError("Formato no permitido. Usá JPG, PNG o WebP.");
      e.target.value = "";
      return;
    }
    if (f.size > MAX_IMG_BYTES) {
      setImagenError("Imagen demasiado grande (máx. 5 MB).");
      e.target.value = "";
      return;
    }
    setImagenFile(f);
    setImagenPreview(URL.createObjectURL(f));
  }

  function quitarImagen() {
    setImagenFile(null);
    setImagenPreview(null);
    setImagenError(null);
  }

  async function handleGenerarCodigoInterno() {
    if (generandoCodigo) return;
    setGenerandoCodigo(true);
    setErrorDuplicado(null);
    setErrorGeneral(null);
    try {
      const res = await fetch("/api/productos/codigo-interno", {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json();
      if (res.ok && json?.success && json.data?.codigo) {
        setForm((prev) => ({ ...prev, codigo_barras: json.data.codigo as string }));
        setCodigoGeneradoInterno(true);
      } else {
        setErrorGeneral(json?.error ?? "No se pudo generar el código.");
      }
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "Error de red");
    } finally {
      setGenerandoCodigo(false);
    }
  }

  // Campos sin lógica reactiva
  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setErrorDuplicado(null);
    setErrorGeneral(null);
    if (e.target.name === "codigo_barras") setCodigoGeneradoInterno(false);
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  /**
   * costo_promedio y precio_venta son INDEPENDIENTES. Cambiar uno no
   * sobrescribe al otro. Markup y margen se calculan en tiempo real (read-only)
   * a partir de ambos valores.
   */
  function handleCostoChange(costo: number) {
    setErrorDuplicado(null);
    setForm((prev) => ({ ...prev, costo_promedio: String(costo) }));
  }

  function handlePrecioChange(precio: number) {
    setErrorDuplicado(null);
    setForm((prev) => ({ ...prev, precio_venta: String(precio) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorDuplicado(null);
    setErrorGeneral(null);

    const codigoEnInput = form.codigo_barras.trim();
    // Solo rechazar prefijo INT- si fue ESCRITO MANUALMENTE (no si vino del botón).
    const esIntManual = !!codigoEnInput && /^INT-/i.test(codigoEnInput) && !codigoGeneradoInterno;
    if (esIntManual) {
      setErrorGeneral('El prefijo "INT-" está reservado para códigos internos generados por el sistema. Dejá el campo vacío y guardá, o usá el botón "Generar código interno".');
      return;
    }

    const duplicado = await productoExiste(form.sku, form.nombre);
    if (duplicado) {
      setErrorDuplicado(
        `Ya existe "${duplicado.nombre}" con SKU ${duplicado.sku}.`
      );
      return;
    }

    setSubmitting(true);
    try {
      // Resolver codigo: si vino del botón → ya está en el input con interno=true.
      // Si el usuario escribió uno → manual (interno=false).
      // Si está vacío → pedir uno interno al backend.
      let codigo: string | null = codigoEnInput || null;
      let interno = codigoGeneradoInterno && !!codigoEnInput;
      if (!codigo) {
        try {
          const res = await fetch("/api/productos/codigo-interno", {
            method: "POST",
            credentials: "include",
          });
          const json = await res.json();
          if (res.ok && json?.success && json.data?.codigo) {
            codigo = json.data.codigo as string;
            interno = true;
          }
        } catch {
          codigo = null;
        }
      }

      const cw = catalogoWebToPayload(catWeb);
      let guardado;
      try {
        guardado = await saveProducto({
          nombre: form.nombre.trim().toUpperCase(),
          sku: form.sku.trim().toUpperCase(),
          costo_promedio: parseFloat(form.costo_promedio) || 0,
          precio_venta: parseFloat(form.precio_venta) || 0,
          stock_actual: parseInt(form.stock_actual) || 0,
          stock_minimo: parseInt(form.stock_minimo) || 0,
          unidad_medida: form.unidad_medida.trim().toUpperCase(),
          metodo_valuacion: form.metodo_valuacion,
          codigo_barras: codigo,
          codigo_barras_interno: interno,
          categoria_principal_id: categoriaId,
          ubicacion_principal_id: ubicacionId,
          proveedor_principal_id: proveedorId,
          // Catálogo web
          slug_web: cw.slug_web,
          visible_web: cw.visible_web,
          destacado_web: cw.destacado_web,
          descripcion_corta: cw.descripcion_corta,
          descripcion_web: cw.descripcion_web,
          marca: cw.marca,
          precio_web: cw.precio_web,
          precio_oferta: cw.precio_oferta,
          oferta_hasta: cw.oferta_hasta,
          nuevo_hasta: cw.nuevo_hasta,
          concentracion: cw.concentracion,
          volumen_ml: cw.volumen_ml,
          genero: cw.genero ?? undefined,
          proximamente: cw.proximamente,
          orden_web: cw.orden_web,
          // familia + notas se mandan aparte por estar fuera del shape Producto
        });
        // Familia + notas (post-create) — best-effort via PATCH al mismo endpoint
        if (guardado && (cw.familia_olfativa_nombre !== null || cw.notas_top.length || cw.notas_heart.length || cw.notas_base.length)) {
          try {
            await fetch(`/api/productos/${guardado.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                familia_olfativa_nombre: cw.familia_olfativa_nombre,
                notas_top: cw.notas_top,
                notas_heart: cw.notas_heart,
                notas_base: cw.notas_base,
              }),
              credentials: "include",
            });
          } catch (e) {
            console.warn("[nuevo producto] catálogo extras fallaron", e);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "No se pudo guardar el producto.";
        setErrorGeneral(msg);
        return;
      }

      if (!guardado) {
        setErrorGeneral("No se pudo guardar el producto. Revisá los datos e intentá nuevamente.");
        return;
      }

      // Subir imagen (post-creacion, con producto_id real)
      if (imagenFile) {
        try {
          const fd = new FormData();
          fd.append("file", imagenFile);
          const up = await fetch(`/api/productos/${guardado.id}/imagen`, {
            method: "POST",
            body: fd,
            credentials: "include",
          });
          const upJson = await up.json();
          if (!up.ok || !upJson?.success) {
            // Producto creado, imagen falló. No perder el producto: ir a editar con aviso.
            const msg = upJson?.error ?? "No se pudo subir la imagen.";
            alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
            router.push(`/inventario/${guardado.id}/editar`);
            return;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Error de red";
          alert(`Producto creado correctamente, pero la imagen no pudo subirse: ${msg}\n\nPodés intentar subirla nuevamente desde la edición del producto.`);
          router.push(`/inventario/${guardado.id}/editar`);
          return;
        }
      }

      router.push("/inventario");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Cálculos en tiempo real ──────────────────────────────────────────────────
  // Markup y margen usan precio EFECTIVO:
  //   - precio_oferta si está vigente (precio_oferta > 0 AND (oferta_hasta vacía
  //     OR oferta_hasta >= now()))
  //   - precio_venta en cualquier otro caso.
  const costo = parseFloat(form.costo_promedio);
  const precioVentaN = parseFloat(form.precio_venta);
  const precioOfertaN = parseFloat(catWeb.precio_oferta);
  const ofertaVigente = (() => {
    if (!Number.isFinite(precioOfertaN) || precioOfertaN <= 0) return false;
    if (!catWeb.oferta_hasta) return true;
    const t = Date.parse(catWeb.oferta_hasta);
    if (Number.isNaN(t)) return true;
    return t >= Date.now();
  })();
  const precioEfectivo = ofertaVigente ? precioOfertaN : precioVentaN;

  const costoOk = Number.isFinite(costo) && costo > 0;
  const precioEfectivoOk = Number.isFinite(precioEfectivo) && precioEfectivo > 0;
  const markupCalc = costoOk && Number.isFinite(precioEfectivo)
    ? ((precioEfectivo - costo) / costo) * 100
    : null;
  const margenVentaCalc = precioEfectivoOk && Number.isFinite(costo)
    ? ((precioEfectivo - costo) / precioEfectivo) * 100
    : null;
  const esPerdida = costoOk && precioEfectivoOk && precioEfectivo < costo;

  // Auto-completar slug desde nombre si el usuario aún no lo tocó
  useEffect(() => {
    if (!catWeb.slug_web && form.nombre.trim()) {
      const auto = slugifyNombre(form.nombre);
      if (auto) setCatWeb((p) => ({ ...p, slug_web: auto }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.nombre]);

  const inputClass =
    "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
  const labelClass = "block text-sm font-medium text-slate-700 mb-2";

  return (
    <div className="space-y-8">

      <div>
        <h1 className="text-3xl font-bold text-gray-800">Nuevo producto</h1>
        <p className="text-gray-600">
          Completa los datos para registrar un producto en inventario
        </p>
      </div>

      <div className="bg-white rounded-xl shadow p-6 max-w-5xl">
        <form className="space-y-6" onSubmit={handleSubmit}>

          {/* Error general (validacion de codigo, duplicado de codigo barras, etc.) */}
          {errorGeneral && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{errorGeneral}</p>
            </div>
          )}

          {/* Error de duplicado (mismo SKU o mismo nombre) */}
          {errorDuplicado && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
              <p className="text-sm font-semibold text-red-700">
                Este producto ya existe en el inventario.
              </p>
              <p className="text-xs text-red-600">{errorDuplicado}</p>
              <p className="text-xs text-red-500">
                Para modificar su stock debés registrar un movimiento de inventario.
              </p>
              <Link
                href="/inventario/movimientos"
                className="inline-block mt-2 text-xs text-red-700 underline hover:text-red-900"
              >
                Ir a Movimientos →
              </Link>
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className={labelClass}>Nombre del producto</label>
            <input
              type="text"
              name="nombre"
              value={form.nombre}
              onChange={handleChange}
              placeholder="Ej: REMERA OVERSIZE BLANCA"
              className={`${inputClass} uppercase`}
              required
            />
          </div>

          {/* SKU + Unidad de medida */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={labelClass}>SKU</label>
              <input
                type="text"
                name="sku"
                value={form.sku}
                onChange={handleChange}
                placeholder="Ej: OOTD-001"
                className={`${inputClass} uppercase`}
                required
              />
            </div>

            <div>
              <label className={labelClass}>Unidad de medida</label>
              <input
                type="text"
                name="unidad_medida"
                value={form.unidad_medida}
                onChange={handleChange}
                placeholder="Ej: UNIDAD, KG, LT"
                className={`${inputClass} uppercase`}
                required
              />
            </div>
          </div>

          {/* Código de barras */}
          <div>
            <label className={labelClass}>
              Código de barras
              {codigoGeneradoInterno && form.codigo_barras && (
                <span className="ml-2 align-middle text-[10px] uppercase tracking-wider bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">
                  Interno
                </span>
              )}
            </label>
            <input
              type="text"
              name="codigo_barras"
              value={form.codigo_barras}
              onChange={handleChange}
              placeholder="Escaneá o escribí — dejá vacío para autogenerar"
              className={inputClass}
              autoComplete="off"
            />
            <div className="mt-2">
              <button
                type="button"
                onClick={handleGenerarCodigoInterno}
                disabled={generandoCodigo}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.431l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                </svg>
                {generandoCodigo ? "Generando..." : "Generar código interno"}
              </button>
              <span className="ml-2 text-xs text-gray-400">(opcional)</span>
            </div>
          </div>

          {/* Imagen del producto */}
          <div>
            <label className={labelClass}>Imagen del producto</label>
            <div className="flex items-start gap-4">
              <div className="w-28 h-28 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {imagenPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imagenPreview} alt="Vista previa" className="w-full h-full object-cover" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-8 h-8 text-slate-300">
                    <path fillRule="evenodd" d="M1 5.25A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25v9.5A2.25 2.25 0 0 1 16.75 17H3.25A2.25 2.25 0 0 1 1 14.75v-9.5Zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 0 0 .75-.75v-2.69l-2.22-2.219a.75.75 0 0 0-1.06 0l-1.91 1.909.47.47a.75.75 0 1 1-1.06 1.06L6.53 8.091a.75.75 0 0 0-1.06 0L2.5 11.06ZM12 6.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white text-sm px-4 py-2 rounded-lg cursor-pointer transition-colors">
                    {imagenFile ? "Cambiar imagen" : "Seleccionar imagen"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleImagenChange}
                    />
                  </label>
                  {imagenFile && (
                    <button
                      type="button"
                      onClick={quitarImagen}
                      className="text-sm text-red-600 hover:text-red-800 px-3 py-2 rounded-lg border border-slate-200 hover:bg-red-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  JPG, PNG o WebP — máx. 5 MB. Se asociará al producto al guardarlo.
                </p>
                {imagenError && (
                  <p className="mt-1.5 text-xs text-red-600">{imagenError}</p>
                )}
              </div>
            </div>
          </div>

          {/* Costo + Precio — independientes */}
          <div>
            <p className="text-xs text-gray-400 mb-3 uppercase tracking-wide font-semibold">
              Precios
            </p>
            <div className="grid grid-cols-2 gap-6">

              <div>
                <label className={labelClass}>Costo promedio (Gs.)</label>
                <MontoInput
                  value={form.costo_promedio}
                  onChange={handleCostoChange}
                  placeholder="Ej: 52000"
                  className={inputClass}
                  decimals={false}
                  required
                />
              </div>

              <div>
                <label className={labelClass}>Precio de venta (Gs.)</label>
                <MontoInput
                  value={form.precio_venta}
                  onChange={handlePrecioChange}
                  placeholder="Ej: 78000"
                  className={inputClass}
                  decimals={false}
                  required
                />
              </div>

            </div>

            {/* Indicadores read-only: markup + margen — calculados con precio efectivo */}
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="border border-blue-100 bg-blue-50 rounded-lg px-4 py-3">
                <p className="text-xs font-medium mb-1 text-blue-500">Markup s/costo</p>
                <p className="text-lg font-bold tabular-nums text-blue-700">
                  {markupCalc !== null ? `${markupCalc.toFixed(2)}%` : "—"}
                </p>
                <p className="text-xs mt-0.5 text-blue-400">
                  {ofertaVigente ? "Calculado con precio de oferta" : "Calculado con precio de venta"}
                </p>
              </div>
              <div className="border border-green-100 bg-green-50 rounded-lg px-4 py-3">
                <p className="text-xs font-medium mb-1 text-green-500">Margen s/venta</p>
                <p className="text-lg font-bold tabular-nums text-green-700">
                  {margenVentaCalc !== null ? `${margenVentaCalc.toFixed(2)}%` : "—"}
                </p>
                <p className="text-xs mt-0.5 text-green-400">
                  {ofertaVigente ? "Calculado con precio de oferta" : "Calculado con precio de venta"}
                </p>
              </div>
            </div>

            {esPerdida && (
              <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-600">
                <span className="mt-0.5 text-base leading-none">⚠</span>
                <span>
                  Atención: con este precio el producto se vende{" "}
                  <strong>por debajo del costo</strong>.
                  {ofertaVigente ? " (precio de oferta vigente)" : ""}
                </span>
              </div>
            )}
          </div>

          {/* Clasificación, Proveedor, Ubicación */}
          <div className="border-t border-slate-100 pt-6">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">
                Clasificación y ubicación
              </p>
              <span className="text-xs text-gray-400">Opcional</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Categoría — 4 cols */}
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Categoría principal</label>
                <SelectFromList
                  value={categoriaId}
                  onChange={setCategoriaId}
                  options={categorias.map((c) => ({ id: c.id, label: c.nombre }))}
                  emptyShort="Sin categorías"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {categorias.length === 0 ? "Todavía no cargaste categorías." : `${categorias.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/categorias"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>

              {/* Proveedor — 4 cols */}
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Proveedor principal</label>
                <SelectFromList
                  value={proveedorId}
                  onChange={setProveedorId}
                  options={proveedores.map((p) => ({ id: p.id, label: p.nombre }))}
                  emptyShort="Sin proveedores"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {proveedores.length === 0 ? "Todavía no cargaste proveedores." : `${proveedores.length} disponibles`}
                  </span>
                  <Link
                    href="/proveedores/nuevo"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>

              {/* Ubicación — 4 cols */}
              <div className="md:col-span-4 min-w-0">
                <label className={labelClass}>Ubicación principal</label>
                <SelectFromList
                  value={ubicacionId}
                  onChange={setUbicacionId}
                  options={ubicaciones.map((u) => ({ id: u.id, label: u.nombre, sublabel: u.tipo }))}
                  emptyShort="Sin ubicaciones"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-400 truncate">
                    {ubicaciones.length === 0 ? "Todavía no cargaste ubicaciones." : `${ubicaciones.length} disponibles`}
                  </span>
                  <Link
                    href="/inventario/ubicaciones"
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 border border-sky-200 hover:bg-sky-50 px-2.5 py-1 rounded-md transition-colors"
                  >
                    + Crear
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Stock actual + Stock mínimo */}
          <div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>Stock actual</label>
                <input
                  type="number"
                  name="stock_actual"
                  value={form.stock_actual}
                  onChange={handleChange}
                  placeholder="Ej: 50"
                  className={inputClass}
                  min={0}
                  required
                />
              </div>

              <div>
                <label className={labelClass}>Stock mínimo</label>
                <input
                  type="number"
                  name="stock_minimo"
                  value={form.stock_minimo}
                  onChange={handleChange}
                  placeholder="Ej: 10"
                  className={inputClass}
                  min={0}
                  required
                />
              </div>
            </div>
            {parseInt(form.stock_actual) > 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Se generará automáticamente un movimiento de inventario inicial con {form.stock_actual} unidades al guardar.
              </p>
            )}
          </div>

          {/* Método de valuación: fijo en CPP — no editable desde la UI.
              El backend recibe siempre `metodo_valuacion: "CPP"` desde state. */}

          {/* Catálogo web */}
          <CatalogoWebFields
            value={catWeb}
            onChange={setCatWeb}
            nombre={form.nombre}
            precioVenta={form.precio_venta}
          />

          {/* Acciones */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-5 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Guardando..." : "Guardar producto"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/inventario")}
              className="border border-slate-200 px-5 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}

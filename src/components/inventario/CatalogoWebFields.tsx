"use client";

/**
 * Sección "Catálogo web" del formulario de productos del ERP.
 *
 * Encapsula los campos que controlan cómo aparece el producto en la web
 * pública: visibilidad, slug, descripciones, marca, precio web, oferta,
 * "nuevo hasta", concentración, volumen, género, próximamente, orden, y
 * pirámide olfativa libre (familia + notas top/heart/base separadas por
 * coma; el server resuelve las filas auxiliares).
 *
 * Estado controlado por el parent. Render-only.
 */

export type CatalogoWebState = {
  slug_web: string;
  visible_web: boolean;
  destacado_web: boolean;
  descripcion_corta: string;
  descripcion_web: string;
  marca: string;
  precio_web: string;        // string en el form, normalizado al guardar
  precio_oferta: string;
  oferta_hasta: string;      // datetime-local
  nuevo_hasta: string;       // date
  concentracion: string;
  volumen_ml: string;
  genero: "" | "masculino" | "femenino" | "unisex";
  proximamente: boolean;
  orden_web: string;
  familia_olfativa_nombre: string;
  notas_top_csv: string;
  notas_heart_csv: string;
  notas_base_csv: string;
};

export const emptyCatalogoWeb: CatalogoWebState = {
  slug_web: "",
  visible_web: false,
  destacado_web: false,
  descripcion_corta: "",
  descripcion_web: "",
  marca: "",
  precio_web: "",
  precio_oferta: "",
  oferta_hasta: "",
  nuevo_hasta: "",
  concentracion: "",
  volumen_ml: "",
  genero: "",
  proximamente: false,
  orden_web: "",
  familia_olfativa_nombre: "",
  notas_top_csv: "",
  notas_heart_csv: "",
  notas_base_csv: "",
};

interface Props {
  value: CatalogoWebState;
  onChange: (next: CatalogoWebState) => void;
}

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-2";

export function CatalogoWebFields({ value, onChange }: Props) {
  function set<K extends keyof CatalogoWebState>(k: K, v: CatalogoWebState[K]) {
    onChange({ ...value, [k]: v });
  }

  return (
    <section className="border-t border-slate-100 pt-6 mt-2">
      <header className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Catálogo web</h2>
          <p className="text-xs text-slate-500">
            Datos visibles en la tienda pública. Si <strong>Visible en web</strong> está apagado,
            el producto queda oculto.
          </p>
        </div>
      </header>

      {/* Toggles principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.visible_web}
            onChange={(e) => set("visible_web", e.target.checked)}
            className="h-4 w-4"
          />
          <span>Visible en la web</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.destacado_web}
            onChange={(e) => set("destacado_web", e.target.checked)}
            className="h-4 w-4"
          />
          <span>Destacado (bestseller)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.proximamente}
            onChange={(e) => set("proximamente", e.target.checked)}
            className="h-4 w-4"
          />
          <span>Próximamente</span>
        </label>
      </div>

      {/* Slug + marca + género */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className={labelClass}>Slug web</label>
          <input
            type="text"
            value={value.slug_web}
            onChange={(e) => set("slug_web", e.target.value.toLowerCase())}
            placeholder="oud-royale"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Marca</label>
          <input
            type="text"
            value={value.marca}
            onChange={(e) => set("marca", e.target.value)}
            placeholder="Maison Élevé"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Género</label>
          <select
            value={value.genero}
            onChange={(e) => set("genero", e.target.value as CatalogoWebState["genero"])}
            className={inputClass}
          >
            <option value="">— Sin definir —</option>
            <option value="masculino">Masculino</option>
            <option value="femenino">Femenino</option>
            <option value="unisex">Unisex</option>
          </select>
        </div>
      </div>

      {/* Descripciones */}
      <div className="grid grid-cols-1 gap-4 mb-4">
        <div>
          <label className={labelClass}>Descripción corta (card)</label>
          <input
            type="text"
            value={value.descripcion_corta}
            onChange={(e) => set("descripcion_corta", e.target.value)}
            placeholder="Una línea para la tarjeta del catálogo"
            className={inputClass}
            maxLength={200}
          />
        </div>
        <div>
          <label className={labelClass}>Descripción larga (detalle)</label>
          <textarea
            value={value.descripcion_web}
            onChange={(e) => set("descripcion_web", e.target.value)}
            placeholder="Texto completo del producto en la página de detalle"
            className={`${inputClass} min-h-[100px]`}
          />
        </div>
      </div>

      {/* Precios web */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className={labelClass}>Precio web (Gs.)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={value.precio_web}
            onChange={(e) => set("precio_web", e.target.value)}
            placeholder="Vacío = usa precio_venta"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Precio oferta (Gs.)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={value.precio_oferta}
            onChange={(e) => set("precio_oferta", e.target.value)}
            placeholder="Si hay promo, este precio reemplaza al web"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Oferta hasta</label>
          <input
            type="datetime-local"
            value={value.oferta_hasta}
            onChange={(e) => set("oferta_hasta", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Nuevo + atributos */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <div>
          <label className={labelClass}>Nuevo hasta</label>
          <input
            type="date"
            value={value.nuevo_hasta}
            onChange={(e) => set("nuevo_hasta", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Concentración</label>
          <input
            type="text"
            value={value.concentracion}
            onChange={(e) => set("concentracion", e.target.value)}
            placeholder="Eau de Parfum"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Volumen (ml)</label>
          <input
            type="number"
            min={0}
            step={1}
            value={value.volumen_ml}
            onChange={(e) => set("volumen_ml", e.target.value)}
            placeholder="100"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Orden web</label>
          <input
            type="number"
            step={1}
            value={value.orden_web}
            onChange={(e) => set("orden_web", e.target.value)}
            placeholder="Más bajo = primero"
            className={inputClass}
          />
        </div>
      </div>

      {/* Familia + notas */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className={labelClass}>Familia olfativa</label>
          <input
            type="text"
            value={value.familia_olfativa_nombre}
            onChange={(e) => set("familia_olfativa_nombre", e.target.value)}
            placeholder="Amaderada · Oriental"
            className={inputClass}
          />
          <p className="text-xs text-slate-500 mt-1">
            Si no existe, se crea automáticamente al guardar.
          </p>
        </div>
        <div>
          <label className={labelClass}>Notas de salida (separadas por coma)</label>
          <input
            type="text"
            value={value.notas_top_csv}
            onChange={(e) => set("notas_top_csv", e.target.value)}
            placeholder="Bergamota, Limón, Mandarina"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Notas de corazón (separadas por coma)</label>
          <input
            type="text"
            value={value.notas_heart_csv}
            onChange={(e) => set("notas_heart_csv", e.target.value)}
            placeholder="Jazmín, Rosa"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Notas de fondo (separadas por coma)</label>
          <input
            type="text"
            value={value.notas_base_csv}
            onChange={(e) => set("notas_base_csv", e.target.value)}
            placeholder="Sándalo, Ámbar"
            className={inputClass}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Convierte el estado del form al payload que va al API. Normaliza:
 *   - números vacíos → null
 *   - genero "" → null
 *   - notas_top_csv / heart / base → arrays de strings recortados
 */
export function catalogoWebToPayload(s: CatalogoWebState) {
  const num = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const csv = (v: string): string[] =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  return {
    slug_web: s.slug_web.trim() || null,
    visible_web: !!s.visible_web,
    destacado_web: !!s.destacado_web,
    descripcion_corta: s.descripcion_corta.trim() || null,
    descripcion_web: s.descripcion_web.trim() || null,
    marca: s.marca.trim() || null,
    precio_web: num(s.precio_web),
    precio_oferta: num(s.precio_oferta),
    oferta_hasta: s.oferta_hasta || null,
    nuevo_hasta: s.nuevo_hasta || null,
    concentracion: s.concentracion.trim() || null,
    volumen_ml: num(s.volumen_ml),
    genero: s.genero || null,
    proximamente: !!s.proximamente,
    orden_web: num(s.orden_web),
    familia_olfativa_nombre: s.familia_olfativa_nombre.trim() || null,
    notas_top: csv(s.notas_top_csv),
    notas_heart: csv(s.notas_heart_csv),
    notas_base: csv(s.notas_base_csv),
  };
}

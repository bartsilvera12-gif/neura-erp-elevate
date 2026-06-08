/**
 * Logica compartida del importador de Productos para preview y commit.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { normalizeUpperText, normalizeUpperNullable } from "@/lib/text/normalize";
import type { PreviewRow, PreviewResponse } from "@/lib/excel/import-types";
import { pick, pickNumber, pickBool, chunked } from "./import-helpers";
import type { Pool } from "pg";

interface ProductoExistente {
  id: string;
  sku: string;
  codigo_barras: string | null;
  stock_actual: number;
}

export interface ProductoParsed {
  row_number: number;
  nombre: string;
  sku: string;
  modelo: string;
  marca: string;
  descripcion_corta: string;
  codigo_barras: string;
  categoria_nombre: string;
  proveedor_nombre: string;
  ubicacion_nombre: string;
  unidad_medida: string;
  costo_promedio: number;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  cantidad_minima_minorista: number | null;
  precio_mayorista: number | null;
  cantidad_minima_mayorista: number | null;
  genero: "masculino" | "femenino" | "unisex" | null;
  volumen_ml: number | null;
  concentracion: string | null;
  es_decant: boolean;
  metodo_valuacion: "CPP" | "FIFO" | "LIFO";
  activo: boolean;
  acordes: string[];
  familia_olfativa: string;
  notas_salida: string[];
  notas_corazon: string[];
  notas_fondo: string[];
  errors: string[];
  warnings: string[];
  match_id?: string | null;
  marca_id?: string | null;
}

const METODOS = new Set(["CPP", "FIFO", "LIFO"]);

/** Mapea valores libres de género a los 3 enums aceptados por la DB.
 *  Es ultra-tolerante: acepta plurales, acentos, mayúsculas/minúsculas, espacios
 *  extra, prefijos parciales, ES/EN, y frases compuestas tipo "PARA HOMBRE",
 *  "FOR WOMEN", "LÍNEA MUJER", "POUR HOMME", "FOR HIM", etc. */
const GENERO_FEM_TOKENS = new Set([
  "mujer", "mujeres", "femenino", "femenina", "feminine", "f", "fem",
  "woman", "women", "womens", "ladies", "lady", "girl", "girls",
  "ella", "ellas", "her", "hers", "femme", "femmes", "donna", "donne",
]);
const GENERO_MASC_TOKENS = new Set([
  "hombre", "hombres", "varon", "varones", "masculino", "masculina", "masculine",
  "m", "masc", "man", "men", "mens", "gentleman", "gentlemen",
  "boy", "boys", "ellos", "him", "his", "homme", "hommes", "uomo", "uomini",
]);
const GENERO_UNI_TOKENS = new Set([
  "unisex", "u", "x", "ambos", "ambas", "todos", "todas",
  "neutral", "neutro", "any", "all", "mixto", "mixta",
]);
function mapGenero(raw: string): "masculino" | "femenino" | "unisex" | null {
  const v = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos: varón→varon
    .trim()
    .toLowerCase();
  if (!v) return null;
  // 1) Match exacto.
  if (GENERO_FEM_TOKENS.has(v)) return "femenino";
  if (GENERO_MASC_TOKENS.has(v)) return "masculino";
  if (GENERO_UNI_TOKENS.has(v)) return "unisex";
  // 2) Tokenización: capta "para hombre", "for women", "linea mujer", "pour homme".
  const tokens = v.split(/[\s\-_,;.\/'"()]+/).filter(Boolean);
  // Prioridad: si aparece "unisex" o "ambos" en cualquier parte, gana unisex.
  if (tokens.some((t) => GENERO_UNI_TOKENS.has(t))) return "unisex";
  const hayFem = tokens.some((t) => GENERO_FEM_TOKENS.has(t));
  const hayMasc = tokens.some((t) => GENERO_MASC_TOKENS.has(t));
  if (hayFem && hayMasc) return "unisex"; // "hombre y mujer" → unisex
  if (hayFem) return "femenino";
  if (hayMasc) return "masculino";
  // 3) Fallback por prefijo (última red para typos).
  if (v.startsWith("muj") || v.startsWith("fem")) return "femenino";
  if (v.startsWith("hom") || v.startsWith("var") || v.startsWith("masc")) return "masculino";
  if (v.startsWith("uni")) return "unisex";
  return null;
}

/** Intenta inferir género desde texto libre (modelo/nombre/descripción) buscando
 *  marcadores típicos de perfumería: "pour homme", "for him", "for men", "para él",
 *  etc. Sólo devuelve un género si encuentra una señal clara — null si ambiguo. */
function inferirGeneroDesdeTexto(text: string): "masculino" | "femenino" | "unisex" | null {
  if (!text) return null;
  const v = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const isFem = /\b(pour\s+femme|for\s+her|for\s+women|para\s+ella|para\s+mujer|de\s+mujer|woman|women|femme|donna|ladies)\b/.test(v);
  const isMasc = /\b(pour\s+homme|for\s+him|for\s+men|para\s+el|para\s+hombre|de\s+hombre|homme|uomo|men's|gentleman)\b/.test(v);
  const isUni = /\b(unisex|for\s+all|para\s+todos)\b/.test(v);
  if (isUni) return "unisex";
  if (isFem && isMasc) return "unisex";
  if (isFem) return "femenino";
  if (isMasc) return "masculino";
  return null;
}

/** Extrae el volumen en ml de un valor de celda libre. Acepta números puros
 *  ("100", "100,5") y números con unidad ("100 ml", "100ML", "30 cc"). Bounds
 *  razonables (1..5000) para no aceptar años/IDs. */
function parseMl(raw: string): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // 1) Número con unidad ml/mL/cc.
  const m1 = s.match(/(\d+(?:[.,]\d+)?)\s*(?:m\s*l|cc)\b/i);
  if (m1) {
    const n = Number(m1[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n) && n >= 1 && n <= 5000) return Math.floor(n);
  }
  // 2) Cell sólo número (formato AR "1.000,5" o EN "1000.5").
  const onlyNum = s.replace(/\./g, "").replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(onlyNum)) {
    const n = Number(onlyNum);
    if (Number.isFinite(n) && n >= 1 && n <= 5000) return Math.floor(n);
  }
  return null;
}

/** Última red: extraer ml de campos descriptivos (MODELO, NOMBRE,
 *  SKU_DESCRIPCION). Requiere unidad explícita "ml"/"cc" para no confundir
 *  códigos/años con volumen. */
function extractMlFromText(text: string): number | null {
  if (!text) return null;
  const m = String(text).match(/(\d+(?:[.,]\d+)?)\s*(?:m\s*l|cc)\b/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 1 && n <= 5000 ? Math.floor(n) : null;
}

/** Distancia de Levenshtein entre dos strings (tope ~30 chars cada uno).
 *  Usada sólo para fuzzy match de marcas con typos de 1 letra. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Devuelve el valor del primer header del row cuyo nombre normalizado
 *  empiece con alguno de los prefijos. Útil para headers largos del Excel
 *  legacy tipo "Familia olfativa (NO OBLIGATORIO CARGAR)". */
function pickByPrefix(row: Record<string, string>, ...prefixes: string[]): string {
  for (const k of Object.keys(row)) {
    for (const p of prefixes) {
      if (k.startsWith(p)) {
        const v = row[k];
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
    }
  }
  return "";
}

function splitCsv(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseProductosRows(rows: Record<string, string>[]): ProductoParsed[] {
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    // MARCA: explícita por aliases comunes + fallback por prefijo de header
    // (ej: "MARCA_PRINCIPAL", "MARCA PRODUCTO", "BRAND NAME").
    const marca = normalizeUpperText(
      pick(r, "MARCA", "MARCA_PRINCIPAL", "MARCA_PRODUCTO", "BRAND", "BRAND_NAME", "FABRICANTE")
        || pickByPrefix(r, "MARCA", "BRAND")
    );
    const modelo = normalizeUpperText(pick(r, "MODELO", "SKU_PRODUCT", "SKU PRODUCT"));
    const descripcion_corta = normalizeUpperText(
      pick(r, "SKU_DESCRIPCION", "SKU DESCRIPCION", "DESCRIPCION_CORTA", "DESCRIPCION CORTA", "DESCRIPCION")
    );
    // NOMBRE: explícito si viene; sino derivamos en este orden de preferencia:
    //   1) MARCA + " " + MODELO  (ej: "DIOR SAUVAGE")
    //   2) MODELO solo
    //   3) SKU DESCRIPCION
    // Esto deja que planillas sin columna NOMBRE igual funcionen.
    let nombre = normalizeUpperText(pick(r, "NOMBRE"));
    if (!nombre) {
      const combo = [marca, modelo].filter(Boolean).join(" ").trim();
      if (combo) nombre = combo;
      else if (modelo) nombre = modelo;
      else if (descripcion_corta) nombre = descripcion_corta;
    }
    if (!nombre) {
      errors.push("NOMBRE obligatorio (también podés cargar MARCA + SKU PRODUCT, o SKU DESCRIPCION).");
    }
    const sku = normalizeUpperText(pick(r, "SKU"));
    const codigo_barras_raw = normalizeUpperText(pick(r, "CODIGO_BARRAS", "CODIGOBARRAS"));
    if (codigo_barras_raw && /^INT-/i.test(codigo_barras_raw)) {
      errors.push('Prefijo "INT-" reservado para códigos generados por el sistema.');
    }
    const mv = normalizeUpperText(pick(r, "METODO_VALUACION", "METODOVALUACION"));
    const metodo_valuacion = (METODOS.has(mv) ? mv : "CPP") as "CPP" | "FIFO" | "LIFO";
    const cantMinMinRaw = pickNumber(
      r,
      "CANTIDAD_MINIMA_MINORISTA",
      "CANTIDAD_MINIMA_VENTA_MINORISTA",
      "CANTIDAD_MINIMA_V_MINORISTA",
      "CANTIDAD MINIMA MINORISTA"
    );
    const cantidad_minima_minorista =
      Number.isFinite(cantMinMinRaw) && cantMinMinRaw >= 1
        ? Math.floor(cantMinMinRaw)
        : null;
    // Precio mayorista (informativo). Solo se setea si vino > 0.
    const precioMayoristaRaw = pickNumber(
      r,
      "PRECIO_MAYORISTA",
      "PRECIO_VENTA_MAYORISTA",
      "PRECIO_VENTA MAYORISTA"
    );
    const precio_mayorista = precioMayoristaRaw > 0 ? precioMayoristaRaw : null;
    const cantMinMayRaw = pickNumber(
      r,
      "CANTIDAD_MINIMA_MAYORISTA",
      "CANTIDAD_MINIMA_VENTA_MAYORISTA",
      "CANTIDAD MINIMA MAYORISTA"
    );
    const cantidad_minima_mayorista =
      Number.isFinite(cantMinMayRaw) && cantMinMayRaw >= 1
        ? Math.floor(cantMinMayRaw)
        : null;
    // Precio de venta: soporto alias "MINORISTA" para planillas legacy.
    const precio_venta = pickNumber(
      r,
      "PRECIO_VENTA",
      "PRECIO_VENTA_MINORISTA",
      "PRECIO_MINORISTA",
      "PRECIO_VENTA MINORISTA"
    );
    const acordesCsv = pick(r, "ACORDES_PRINCIPALES", "ACORDES", "ACORDES PRINCIPALES", "ACORDES_OLFATIVOS");
    const acordes = splitCsv(acordesCsv);
    // Género: mapeo libre → enum DB. Aliases extra + inferencia desde nombre/modelo.
    const generoRaw = pick(r, "GENERO", "GENDER", "SEXO", "PUBLICO", "DESTINADO_A", "LINEA")
      || pickByPrefix(r, "GENERO", "GENDER", "SEXO");
    let genero = mapGenero(generoRaw);
    if (generoRaw && !genero) {
      warnings.push(`GENERO "${generoRaw}" no reconocido — se intenta inferir del nombre/modelo.`);
    }
    // Si vino vacío o no reconocido, intentar inferir de modelo/nombre/descripción
    // buscando "POUR HOMME", "FOR HER", "PARA HOMBRE", etc.
    if (!genero) {
      genero = inferirGeneroDesdeTexto(modelo)
        ?? inferirGeneroDesdeTexto(nombre)
        ?? inferirGeneroDesdeTexto(descripcion_corta);
      if (genero) {
        warnings.push(`GENERO inferido del nombre/modelo: ${genero.toUpperCase()}.`);
      }
    }
    // Volumen en ml: parser tolerante + aliases + fallback por prefijo +
    // extracción desde texto descriptivo como última red.
    let volumen_ml = parseMl(
      pick(r, "VOLUMEN_ML", "PRESENTACION_ML", "ML", "CAPACIDAD_ML", "TAMANO_ML",
              "MILILITROS", "CONTENIDO_ML", "CC")
    );
    if (volumen_ml == null) {
      volumen_ml = parseMl(
        pickByPrefix(r, "VOLUMEN", "PRESENTACION", "TAMANO", "CAPACIDAD",
                        "MILILITROS", "CONTENIDO")
      );
    }
    if (volumen_ml == null) {
      volumen_ml = extractMlFromText(modelo)
        ?? extractMlFromText(nombre)
        ?? extractMlFromText(descripcion_corta);
      if (volumen_ml != null) {
        warnings.push(`VOLUMEN_ML inferido del texto: ${volumen_ml} ml.`);
      }
    }
    const concentracion = normalizeUpperText(pick(r, "CONCENTRACION", "CONCENTRACIÓN")) || null;
    // Tipo de presentación: si contiene "DECANT" lo marcamos es_decant.
    const tipoPresentacion = normalizeUpperText(
      pick(r, "TIPO_PRESENTACION", "TIPO_DE_PRESENTACION", "TIPO DE PRESENTACION")
    );
    const es_decant = /DECANT/.test(tipoPresentacion);
    // Familia + notas olfativas. Soporto el header largo legacy via prefijo.
    const familia_olfativa = pick(r, "FAMILIA_OLFATIVA")
      || pickByPrefix(r, "FAMILIA_OLFATIVA");
    const notas_salida = splitCsv(
      pick(r, "NOTAS_SALIDA", "NOTAS_DE_SALIDA")
        || pickByPrefix(r, "NOTAS_DE_SALIDA", "NOTAS_SALIDA")
    );
    const notas_corazon = splitCsv(
      pick(r, "NOTAS_CORAZON", "NOTAS_DE_CORAZON")
        || pickByPrefix(r, "NOTAS_DE_CORAZON", "NOTAS_CORAZON")
    );
    const notas_fondo = splitCsv(
      pick(r, "NOTAS_FONDO", "NOTAS_DE_FONDO")
        || pickByPrefix(r, "NOTAS_DE_FONDO", "NOTAS_FONDO")
    );
    return {
      row_number: idx + 2,
      nombre,
      sku,
      modelo,
      marca,
      descripcion_corta,
      codigo_barras: codigo_barras_raw,
      categoria_nombre: normalizeUpperText(pick(r, "CATEGORIA", "CATEGORIA_PRINCIPAL")),
      proveedor_nombre: normalizeUpperText(pick(r, "PROVEEDOR_PRINCIPAL", "PROVEEDOR")),
      ubicacion_nombre: normalizeUpperText(pick(r, "UBICACION_PRINCIPAL", "UBICACION")),
      unidad_medida: normalizeUpperText(pick(r, "UNIDAD_MEDIDA", "UNIDADMEDIDA")) || "UNIDAD",
      costo_promedio: pickNumber(r, "COSTO_PROMEDIO"),
      precio_venta,
      stock_actual: pickNumber(r, "STOCK_ACTUAL"),
      stock_minimo: pickNumber(r, "STOCK_MINIMO"),
      cantidad_minima_minorista,
      precio_mayorista,
      cantidad_minima_mayorista,
      genero,
      volumen_ml,
      concentracion,
      es_decant,
      metodo_valuacion,
      activo: pickBool(r, "ACTIVO"),
      acordes,
      familia_olfativa,
      notas_salida,
      notas_corazon,
      notas_fondo,
      errors,
      warnings,
    };
  });
}

export interface ResolverMaps {
  productosBySku: Map<string, ProductoExistente>;
  productosByCodigo: Map<string, ProductoExistente>;
  categoriasByName: Map<string, string>;
  proveedoresByName: Map<string, string>;
  ubicacionesByName: Map<string, string>;
  ubicacionesByCodigo: Map<string, string>;
  marcasByName: Map<string, string>;
}

export async function buildResolverMaps(schemaRaw: string, empresaId: string): Promise<ResolverMaps> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const tP = quoteSchemaTable(schema, "productos");
  const tC = quoteSchemaTable(schema, "categorias_productos");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const tU = quoteSchemaTable(schema, "inventario_ubicaciones");
  const tMar = quoteSchemaTable(schema, "marcas");

  const [prods, cats, provs, ubis, marcas] = await Promise.all([
    pool.query<ProductoExistente>(`SELECT id, sku, codigo_barras, stock_actual FROM ${tP} WHERE empresa_id=$1::uuid`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tC} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tPr} WHERE empresa_id=$1::uuid`, [empresaId]),
    pool.query<{ id: string; nombre: string; codigo: string | null }>(`SELECT id, nombre, codigo FROM ${tU} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tMar} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
  ]);

  const productosBySku = new Map<string, ProductoExistente>();
  const productosByCodigo = new Map<string, ProductoExistente>();
  for (const p of prods.rows) {
    const normalized: ProductoExistente = { id: p.id, sku: p.sku, codigo_barras: p.codigo_barras, stock_actual: Number(p.stock_actual) };
    if (p.sku) productosBySku.set(p.sku.toUpperCase(), normalized);
    if (p.codigo_barras) productosByCodigo.set(p.codigo_barras.toUpperCase(), normalized);
  }
  const categoriasByName = new Map<string, string>();
  for (const c of cats.rows) categoriasByName.set(c.nombre.trim().toUpperCase(), c.id);
  const proveedoresByName = new Map<string, string>();
  for (const p of provs.rows) proveedoresByName.set(p.nombre.trim().toUpperCase(), p.id);
  const ubicacionesByName = new Map<string, string>();
  const ubicacionesByCodigo = new Map<string, string>();
  for (const u of ubis.rows) {
    ubicacionesByName.set(u.nombre.trim().toUpperCase(), u.id);
    if (u.codigo) ubicacionesByCodigo.set(u.codigo.trim().toUpperCase(), u.id);
  }
  const marcasByName = new Map<string, string>();
  for (const m of marcas.rows) marcasByName.set(m.nombre.trim().toUpperCase(), m.id);
  return { productosBySku, productosByCodigo, categoriasByName, proveedoresByName, ubicacionesByName, ubicacionesByCodigo, marcasByName };
}

export function buildPreview(parsed: ProductoParsed[], maps: ResolverMaps): PreviewResponse {
  const catsFaltantes = new Set<string>();
  const provsFaltantes = new Set<string>();
  const ubisFaltantes = new Set<string>();
  const marcasFaltantes = new Set<string>();
  let insertar = 0, actualizar = 0, errores = 0, warnings = 0;
  let totalEntrada = 0, totalSalida = 0, movimientosGenerar = 0;
  const omitir = 0;
  const skuVistos = new Set<string>();
  const codbarVistos = new Set<string>();

  const rows: PreviewRow[] = parsed.map((p) => {
    // Errores fila
    if (p.sku && skuVistos.has(p.sku)) p.errors.push(`SKU "${p.sku}" duplicado en el archivo.`);
    if (p.sku) skuVistos.add(p.sku);
    if (p.codigo_barras && codbarVistos.has(p.codigo_barras)) p.errors.push(`Código de barras "${p.codigo_barras}" duplicado en el archivo.`);
    if (p.codigo_barras) codbarVistos.add(p.codigo_barras);

    // Match contra DB existente
    let matchId: string | null = null;
    let stockAnterior: number | null = null;
    if (p.codigo_barras && maps.productosByCodigo.has(p.codigo_barras)) {
      const ex = maps.productosByCodigo.get(p.codigo_barras)!;
      matchId = ex.id; stockAnterior = ex.stock_actual;
    } else if (p.sku && maps.productosBySku.has(p.sku)) {
      const ex = maps.productosBySku.get(p.sku)!;
      matchId = ex.id; stockAnterior = ex.stock_actual;
    }
    p.match_id = matchId;

    // Faltantes
    if (p.categoria_nombre && !maps.categoriasByName.has(p.categoria_nombre)) {
      p.warnings.push(`Categoría "${p.categoria_nombre}" no existe.`);
      catsFaltantes.add(p.categoria_nombre);
    }
    if (p.proveedor_nombre && !maps.proveedoresByName.has(p.proveedor_nombre)) {
      p.warnings.push(`Proveedor "${p.proveedor_nombre}" no existe.`);
      provsFaltantes.add(p.proveedor_nombre);
    }
    if (p.ubicacion_nombre && !maps.ubicacionesByName.has(p.ubicacion_nombre) && !maps.ubicacionesByCodigo.has(p.ubicacion_nombre)) {
      p.warnings.push(`Ubicación "${p.ubicacion_nombre}" no existe.`);
      ubisFaltantes.add(p.ubicacion_nombre);
    }
    // Marca: resuelve a marca_id (FK).
    //   1) match exacto por nombre upper-trimmed.
    //   2) fuzzy: typo de 1 letra contra marcas existentes (DIIOR→DIOR).
    //   3) si sigue sin venir, intentar inferir desde el inicio de modelo/nombre.
    //   4) si no existe, marcarla como faltante para "crear faltantes".
    if (p.marca) {
      let mid = maps.marcasByName.get(p.marca);
      if (!mid && p.marca.length >= 4) {
        // Fuzzy: una sola edición y nombres parecidos en longitud (±2).
        let best: { nombre: string; dist: number } | null = null;
        for (const [nombre] of maps.marcasByName) {
          if (Math.abs(nombre.length - p.marca.length) > 2) continue;
          const d = levenshtein(p.marca, nombre);
          if (d <= 1 && (!best || d < best.dist)) best = { nombre, dist: d };
        }
        if (best) {
          p.warnings.push(`Marca "${p.marca}" mapeada a "${best.nombre}" (typo).`);
          p.marca = best.nombre;
          mid = maps.marcasByName.get(best.nombre);
        }
      }
      if (mid) {
        p.marca_id = mid;
      } else {
        p.warnings.push(`Marca "${p.marca}" no existe (se creará si tildás "crear faltantes").`);
        marcasFaltantes.add(p.marca);
      }
    } else {
      // Inferir marca del comienzo del modelo o nombre. Probar primero 2 palabras
      // (ej "HUGO BOSS"), después 1 palabra. Sólo aceptamos si matchea exacto en DB.
      const candidatos = [p.modelo, p.nombre].filter(Boolean);
      for (const cand of candidatos) {
        const words = cand.split(/\s+/).filter(Boolean);
        for (const len of [2, 1] as const) {
          if (words.length < len) continue;
          const guess = words.slice(0, len).join(" ").toUpperCase();
          if (guess && maps.marcasByName.has(guess)) {
            p.marca = guess;
            p.marca_id = maps.marcasByName.get(guess)!;
            p.warnings.push(`Marca "${guess}" inferida del nombre del producto.`);
            break;
          }
        }
        if (p.marca) break;
      }
    }

    // Avisos finales: campos clave que quedaron vacíos tras todos los intentos.
    // Permite ver de un vistazo en el preview qué filas hay que completar antes
    // de commitear.
    if (!p.marca) p.warnings.push("MARCA vacía — no se pudo determinar (revisar columna MARCA o nombre del producto).");
    if (!p.genero) p.warnings.push("GENERO vacío — no se pudo determinar (esperado: MUJER, HOMBRE, UNISEX).");
    if (p.volumen_ml == null) p.warnings.push("VOLUMEN_ML vacío — no se pudo determinar (revisar columna o agregar '100ml' al nombre).");

    const hasErr = p.errors.length > 0;
    const action = hasErr ? "ERROR" : matchId ? "UPDATE" : "INSERT";
    if (action === "INSERT") insertar++;
    else if (action === "UPDATE") actualizar++;
    else if (action === "ERROR") errores++;
    if (p.warnings.length > 0) warnings++;

    // Calcular impacto de stock que se generara
    let stockMov: string = "SIN MOVIMIENTO";
    if (!hasErr) {
      if (action === "INSERT" && p.stock_actual > 0) {
        stockMov = `ENTRADA +${p.stock_actual}`;
        totalEntrada += p.stock_actual;
        movimientosGenerar++;
      } else if (action === "UPDATE" && stockAnterior != null) {
        const delta = p.stock_actual - stockAnterior;
        if (delta > 0) {
          stockMov = `ENTRADA +${delta} (prev=${stockAnterior})`;
          totalEntrada += delta; movimientosGenerar++;
        } else if (delta < 0) {
          stockMov = `SALIDA ${delta} (prev=${stockAnterior})`;
          totalSalida += -delta; movimientosGenerar++;
        }
      }
    }

    return {
      row_number: p.row_number,
      action: action as "INSERT" | "UPDATE" | "ERROR" | "SKIP",
      warnings: p.warnings,
      errors: p.errors,
      data: {
        NOMBRE: p.nombre, SKU: p.sku, MODELO: p.modelo, MARCA: p.marca,
        CODIGO_BARRAS: p.codigo_barras || "(auto)",
        CATEGORIA: p.categoria_nombre, PROVEEDOR: p.proveedor_nombre, UBICACION: p.ubicacion_nombre,
        COSTO: p.costo_promedio, PRECIO: p.precio_venta, STOCK: p.stock_actual,
        STOCK_ANTERIOR: stockAnterior ?? "",
        MOVIMIENTO: stockMov,
      },
    };
  });

  return {
    summary: {
      total: parsed.length,
      insertar, actualizar, omitir, errores, warnings,
      faltantes: {
        categorias: [...catsFaltantes],
        proveedores: [...provsFaltantes],
        ubicaciones: [...ubisFaltantes],
        marcas: [...marcasFaltantes],
      },
      movimientos_a_generar: movimientosGenerar,
      unidades_entrada: totalEntrada,
      unidades_salida: totalSalida,
    },
    rows,
    headers: ["NOMBRE","SKU","CODIGO_BARRAS","MARCA","SKU PRODUCT","SKU DESCRIPCION","CATEGORIA","GENERO","VOLUMEN_ML","CONCENTRACION","TIPO_PRESENTACION","PROVEEDOR_PRINCIPAL","UBICACION_PRINCIPAL","UNIDAD_MEDIDA","COSTO_PROMEDIO","PRECIO_VENTA","CANTIDAD_MINIMA_MINORISTA","PRECIO_VENTA_MAYORISTA","CANTIDAD_MINIMA_MAYORISTA","STOCK_ACTUAL","STOCK_MINIMO","METODO_VALUACION","ACTIVO","ACORDES_PRINCIPALES","FAMILIA_OLFATIVA","NOTAS_SALIDA","NOTAS_CORAZON","NOTAS_FONDO"],
  };
}

export interface CommitOutcome {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  warnings: number;
  movimientos_generados: number;
  unidades_entrada: number;
  unidades_salida: number;
  errorMessages: string[];
  warningMessages: string[];
}

export interface CommitContext {
  filename?: string | null;
  createdBy?: string | null;
  usuarioNombre?: string | null;
}

export async function commitProductos(
  schemaRaw: string,
  empresaId: string,
  parsed: ProductoParsed[],
  maps: ResolverMaps,
  crearFaltantes: boolean,
  ctx: CommitContext = {}
): Promise<CommitOutcome> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const poolMaybe = getChatPostgresPool();
  if (!poolMaybe) throw new Error("Pool no disponible.");
  const pool = poolMaybe;
  const tP = quoteSchemaTable(schema, "productos");
  const tC = quoteSchemaTable(schema, "categorias_productos");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const tU = quoteSchemaTable(schema, "inventario_ubicaciones");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tA = quoteSchemaTable(schema, "acordes_olfativos");
  const tPA = quoteSchemaTable(schema, "producto_acordes");
  const tMar = quoteSchemaTable(schema, "marcas");
  const tFO = quoteSchemaTable(schema, "familias_olfativas");
  const tNO = quoteSchemaTable(schema, "notas_olfativas");
  const tPN = quoteSchemaTable(schema, "producto_notas");
  const tSec = `"${schema.replace(/"/g, '""')}".incrementar_secuencia_producto`;
  const fnSkuGen = `"${schema.replace(/"/g, '""')}".generar_sku_producto`;
  const refImport = `IMPORT_EXCEL:${(ctx.filename ?? "").slice(0, 80)}`;

  const out: CommitOutcome = {
    inserted: 0, updated: 0, skipped: 0, errors: 0, warnings: 0,
    movimientos_generados: 0, unidades_entrada: 0, unidades_salida: 0,
    errorMessages: [], warningMessages: [],
  };

  async function registrarMovimiento(
    producto_id: string, producto_nombre: string, producto_sku: string,
    tipo: "ENTRADA" | "SALIDA", origen: "inventario_inicial" | "ajuste_manual",
    cantidad: number, costo_unitario: number, refExtra?: string
  ): Promise<void> {
    if (cantidad <= 0) return;
    const refFinal = refExtra ? `${refImport} ${refExtra}` : refImport;
    try {
      await pool.query(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, now(),
           $10::uuid, $11
         )`,
        [empresaId, producto_id, producto_nombre, producto_sku, tipo, cantidad,
         costo_unitario, origen, refFinal, ctx.createdBy ?? null, ctx.usuarioNombre ?? null]
      );
      out.movimientos_generados++;
      if (tipo === "ENTRADA") out.unidades_entrada += cantidad;
      else out.unidades_salida += cantidad;
    } catch (e) {
      out.warningMessages.push(`No se pudo registrar movimiento para ${producto_nombre}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  // Crear faltantes (categorias/proveedores/ubicaciones/marcas) si corresponde
  if (crearFaltantes) {
    const cats = new Set<string>();
    const provs = new Set<string>();
    const ubis = new Set<string>();
    const marcasNew = new Set<string>();
    for (const p of parsed) {
      if (p.categoria_nombre && !maps.categoriasByName.has(p.categoria_nombre)) cats.add(p.categoria_nombre);
      if (p.proveedor_nombre && !maps.proveedoresByName.has(p.proveedor_nombre)) provs.add(p.proveedor_nombre);
      if (p.ubicacion_nombre && !maps.ubicacionesByName.has(p.ubicacion_nombre) && !maps.ubicacionesByCodigo.has(p.ubicacion_nombre)) ubis.add(p.ubicacion_nombre);
      if (p.marca && !maps.marcasByName.has(p.marca)) marcasNew.add(p.marca);
    }
    for (const nombre of cats) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${tC} (empresa_id, nombre, activo) VALUES ($1::uuid,$2,true) RETURNING id`, [empresaId, nombre]);
        maps.categoriasByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Categoría creada: ${nombre}`);
      } catch (e) { out.errorMessages.push(`No se pudo crear categoría ${nombre}: ${(e as Error).message}`); }
    }
    for (const nombre of provs) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${tPr} (empresa_id, nombre, estado) VALUES ($1::uuid,$2,'activo') RETURNING id`, [empresaId, nombre]);
        maps.proveedoresByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Proveedor creado: ${nombre}`);
      } catch (e) { out.errorMessages.push(`No se pudo crear proveedor ${nombre}: ${(e as Error).message}`); }
    }
    for (const nombre of ubis) {
      try {
        const r = await pool.query<{ id: string }>(`INSERT INTO ${tU} (empresa_id, nombre, tipo, activo) VALUES ($1::uuid,$2,'otro',true) RETURNING id`, [empresaId, nombre]);
        maps.ubicacionesByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Ubicación creada: ${nombre} (tipo: otro)`);
      } catch (e) { out.errorMessages.push(`No se pudo crear ubicación ${nombre}: ${(e as Error).message}`); }
    }
    for (const nombre of marcasNew) {
      try {
        const slug = slugifyMarca(nombre);
        const r = await pool.query<{ id: string }>(
          `INSERT INTO ${tMar} (empresa_id, nombre, slug_web, visible_web, orden_web, activo)
           VALUES ($1::uuid, $2, $3, true, 0, true)
           RETURNING id`,
          [empresaId, nombre, slug]
        );
        maps.marcasByName.set(nombre, r.rows[0].id);
        out.warningMessages.push(`Marca creada: ${nombre}`);
      } catch (e) { out.errorMessages.push(`No se pudo crear marca ${nombre}: ${(e as Error).message}`); }
    }
    // Refrescar marca_id en las filas parseadas que dependían del create.
    for (const p of parsed) {
      if (p.marca && !p.marca_id) {
        const mid = maps.marcasByName.get(p.marca);
        if (mid) p.marca_id = mid;
      }
    }
  }

  // Procesar productos en chunks
  for (const chunk of chunked(parsed, 200)) {
    for (const p of chunk) {
      if (p.errors.length > 0) { out.errors++; out.errorMessages.push(`Fila ${p.row_number}: ${p.errors.join("; ")}`); continue; }
      const categoriaId = p.categoria_nombre ? maps.categoriasByName.get(p.categoria_nombre) ?? null : null;
      const proveedorId = p.proveedor_nombre ? maps.proveedoresByName.get(p.proveedor_nombre) ?? null : null;
      const ubicacionId = p.ubicacion_nombre
        ? (maps.ubicacionesByName.get(p.ubicacion_nombre) ?? maps.ubicacionesByCodigo.get(p.ubicacion_nombre) ?? null)
        : null;

      try {
        if (p.match_id) {
          // UPDATE — leer stock anterior para calcular delta y generar movimiento
          const prevQ = await pool.query<{ stock_actual: string | number; nombre: string; sku: string }>(
            `SELECT stock_actual, nombre, sku FROM ${tP} WHERE id=$1::uuid AND empresa_id=$2::uuid`,
            [p.match_id, empresaId]
          );
          const stockAnterior = Number(prevQ.rows[0]?.stock_actual ?? 0);
          await pool.query(
            `UPDATE ${tP} SET
               nombre=$1, sku=$2, modelo=NULLIF($3,''), codigo_barras=NULLIF($4,''),
               unidad_medida=$5, costo_promedio=$6::numeric, precio_venta=$7::numeric,
               stock_actual=$8::numeric, stock_minimo=$9::numeric,
               cantidad_minima_minorista=$10::int,
               metodo_valuacion=$11, activo=$12::boolean,
               categoria_principal_id=$13::uuid, proveedor_principal_id=$14::uuid, ubicacion_principal_id=$15::uuid,
               marca=NULLIF($18,''),
               descripcion_corta=NULLIF($19,''),
               marca_id=$20::uuid,
               genero=$21,
               volumen_ml=$22::int,
               concentracion=NULLIF($23,''),
               precio_mayorista=$24::numeric,
               cantidad_minima_mayorista=$25::int,
               es_decant=$26::boolean,
               updated_at=now()
             WHERE id=$16::uuid AND empresa_id=$17::uuid`,
            [p.nombre, p.sku, p.modelo, p.codigo_barras, p.unidad_medida, p.costo_promedio, p.precio_venta,
             p.stock_actual, p.stock_minimo, p.cantidad_minima_minorista, p.metodo_valuacion, p.activo,
             categoriaId, proveedorId, ubicacionId, p.match_id, empresaId,
             p.marca, p.descripcion_corta,
             p.marca_id ?? null, p.genero, p.volumen_ml, p.concentracion,
             p.precio_mayorista, p.cantidad_minima_mayorista, p.es_decant]
          );
          out.updated++;
          // Sincronizar acordes (reemplazar selección).
          if (p.acordes.length > 0) {
            try {
              await syncAcordesPorNombre(pool, tA, tPA, empresaId, p.match_id, p.acordes);
            } catch (e) {
              out.warningMessages.push(`Fila ${p.row_number}: acordes no sincronizados (${(e as Error).message.slice(0, 100)})`);
            }
          }
          // Sincronizar familia olfativa + notas (top/heart/base).
          if (p.familia_olfativa || p.notas_salida.length || p.notas_corazon.length || p.notas_fondo.length) {
            try {
              await syncFamiliaYNotas(pool, tFO, tNO, tPN, tP, empresaId, p.match_id, {
                familia_nombre: p.familia_olfativa || null,
                notas_top: p.notas_salida,
                notas_heart: p.notas_corazon,
                notas_base: p.notas_fondo,
              });
            } catch (e) {
              out.warningMessages.push(`Fila ${p.row_number}: familia/notas no sincronizadas (${(e as Error).message.slice(0, 100)})`);
            }
          }
          // Movimiento por delta (ajuste_manual + ENTRADA/SALIDA segun signo)
          const delta = p.stock_actual - stockAnterior;
          if (delta !== 0) {
            await registrarMovimiento(
              p.match_id, p.nombre, p.sku,
              delta > 0 ? "ENTRADA" : "SALIDA", "ajuste_manual",
              Math.abs(delta), p.costo_promedio,
              `Δ ${delta > 0 ? "+" : ""}${delta} (prev=${stockAnterior} new=${p.stock_actual})`
            );
          }
        } else {
          // Generar SKU automático si no vino (formato ELE_PER_####), igual
          // que el botón "Generar SKU" del form de nuevo producto.
          let skuFinal = p.sku;
          if (!skuFinal) {
            try {
              const r = await pool.query<{ v: string }>(
                `SELECT ${fnSkuGen}($1::uuid, $2) AS v`,
                [empresaId, "ELE_PER"]
              );
              const generated = r.rows[0]?.v?.trim();
              if (generated) {
                skuFinal = generated;
                out.warningMessages.push(`Fila ${p.row_number}: SKU vacío → generado ${generated}`);
              } else {
                out.errorMessages.push(`Fila ${p.row_number}: no se pudo generar SKU automático.`);
                out.errors++;
                continue;
              }
            } catch (e) {
              out.errorMessages.push(`Fila ${p.row_number}: error generando SKU (${(e as Error).message.slice(0, 100)})`);
              out.errors++;
              continue;
            }
          }
          // Generar codigo_barras_interno si no vino
          let codigoBarras = p.codigo_barras;
          let codigoInterno = false;
          if (!codigoBarras) {
            try {
              const r = await pool.query<{ v: string }>(`SELECT ${tSec}($1::uuid) AS v`, [empresaId]);
              const seq = Number(r.rows[0]?.v ?? 0);
              if (seq > 0) {
                codigoBarras = `INT-${String(seq).padStart(6, "0")}`;
                codigoInterno = true;
              }
            } catch (e) { out.warningMessages.push(`Fila ${p.row_number}: no se pudo generar código interno (${(e as Error).message})`); }
          }
          const inserted = await pool.query<{ id: string }>(
            `INSERT INTO ${tP} (
               empresa_id, nombre, sku, modelo, codigo_barras, codigo_barras_interno,
               unidad_medida, costo_promedio, precio_venta, stock_actual, stock_minimo,
               cantidad_minima_minorista,
               metodo_valuacion, activo, categoria_principal_id, proveedor_principal_id, ubicacion_principal_id,
               marca, descripcion_corta,
               marca_id, genero, volumen_ml, concentracion,
               precio_mayorista, cantidad_minima_mayorista, es_decant
             ) VALUES (
               $1::uuid, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), $6::boolean,
               $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric,
               $12::int,
               $13, $14::boolean, $15::uuid, $16::uuid, $17::uuid,
               NULLIF($18,''), NULLIF($19,''),
               $20::uuid, $21, $22::int, NULLIF($23,''),
               $24::numeric, $25::int, $26::boolean
             ) RETURNING id`,
            [empresaId, p.nombre, skuFinal, p.modelo, codigoBarras, codigoInterno,
             p.unidad_medida, p.costo_promedio, p.precio_venta, p.stock_actual, p.stock_minimo,
             p.cantidad_minima_minorista,
             p.metodo_valuacion, p.activo, categoriaId, proveedorId, ubicacionId,
             p.marca, p.descripcion_corta,
             p.marca_id ?? null, p.genero, p.volumen_ml, p.concentracion,
             p.precio_mayorista, p.cantidad_minima_mayorista, p.es_decant]
          );
          out.inserted++;
          // Sincronizar acordes para producto nuevo.
          if (p.acordes.length > 0 && inserted.rows[0]?.id) {
            try {
              await syncAcordesPorNombre(pool, tA, tPA, empresaId, inserted.rows[0].id, p.acordes);
            } catch (e) {
              out.warningMessages.push(`Fila ${p.row_number}: acordes no sincronizados (${(e as Error).message.slice(0, 100)})`);
            }
          }
          // Sincronizar familia olfativa + notas para producto nuevo.
          if (inserted.rows[0]?.id &&
              (p.familia_olfativa || p.notas_salida.length || p.notas_corazon.length || p.notas_fondo.length)) {
            try {
              await syncFamiliaYNotas(pool, tFO, tNO, tPN, tP, empresaId, inserted.rows[0].id, {
                familia_nombre: p.familia_olfativa || null,
                notas_top: p.notas_salida,
                notas_heart: p.notas_corazon,
                notas_base: p.notas_fondo,
              });
            } catch (e) {
              out.warningMessages.push(`Fila ${p.row_number}: familia/notas no sincronizadas (${(e as Error).message.slice(0, 100)})`);
            }
          }
          // Movimiento de inventario inicial si stock > 0
          if (p.stock_actual > 0 && inserted.rows[0]?.id) {
            await registrarMovimiento(
              inserted.rows[0].id, p.nombre, p.sku,
              "ENTRADA", "inventario_inicial",
              p.stock_actual, p.costo_promedio
            );
          }
        }
        if (p.warnings.length > 0) out.warnings++;
      } catch (e) {
        out.errors++;
        const msg = (e as Error).message;
        const code = (e as { code?: string })?.code;
        if (code === "23505") {
          out.errorMessages.push(`Fila ${p.row_number}: SKU/Código duplicado (${msg.slice(0, 80)})`);
        } else {
          out.errorMessages.push(`Fila ${p.row_number}: ${msg.slice(0, 200)}`);
        }
      }
    }
  }
  return out;
}

/**
 * Reemplaza la selección de acordes de un producto, resolviendo por nombre
 * contra `acordes_olfativos` (case-insensitive). Si un nombre no existe en el
 * catálogo, lo crea on-the-fly. El orden se preserva (0..N) según el array.
 */
async function syncAcordesPorNombre(
  pool: Pool,
  tA: string,
  tPA: string,
  empresaId: string,
  productoId: string,
  nombres: string[]
): Promise<void> {
  // Limpia espacios y deduplica preservando orden.
  const limpios: string[] = [];
  const vistos = new Set<string>();
  for (const raw of nombres) {
    const v = raw.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    limpios.push(v);
  }
  // Borrar selección actual.
  await pool.query(
    `DELETE FROM ${tPA} WHERE producto_id=$1::uuid AND empresa_id=$2::uuid`,
    [productoId, empresaId]
  );
  if (limpios.length === 0) return;

  // Resolver/crear cada acorde y armar pares ordenados.
  const ids: string[] = [];
  for (const nombre of limpios) {
    const slug = nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    // Buscar por nombre case-insensitive en la empresa.
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM ${tA} WHERE empresa_id=$1::uuid AND lower(btrim(nombre)) = lower(btrim($2)) LIMIT 1`,
      [empresaId, nombre]
    );
    let acordeId = found.rows[0]?.id ?? null;
    if (!acordeId) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO ${tA} (empresa_id, nombre, slug_web)
         VALUES ($1::uuid, $2, $3)
         ON CONFLICT ON CONSTRAINT acordes_slug_web_unico_por_empresa DO UPDATE SET nombre=EXCLUDED.nombre
         RETURNING id`,
        [empresaId, nombre, slug]
      );
      acordeId = ins.rows[0]?.id ?? null;
    }
    if (acordeId) ids.push(acordeId);
  }
  // Insertar relaciones con orden 0..N.
  for (let i = 0; i < ids.length; i++) {
    await pool.query(
      `INSERT INTO ${tPA} (empresa_id, producto_id, acorde_id, orden)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::int)
       ON CONFLICT (producto_id, acorde_id) DO UPDATE SET orden=EXCLUDED.orden`,
      [empresaId, productoId, ids[i], i]
    );
  }
}

function slugifyMarca(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Sincroniza familia olfativa + notas (top/heart/base) de un producto.
 * Find-or-create por nombre en familias_olfativas y notas_olfativas. Reemplaza
 * la selección de producto_notas por posición.
 */
async function syncFamiliaYNotas(
  pool: Pool,
  tFO: string,
  tNO: string,
  tPN: string,
  tP: string,
  empresaId: string,
  productoId: string,
  data: {
    familia_nombre: string | null;
    notas_top: string[];
    notas_heart: string[];
    notas_base: string[];
  }
): Promise<void> {
  // 1) Familia olfativa → setea productos.familia_olfativa_id
  if (data.familia_nombre && data.familia_nombre.trim()) {
    const nombre = data.familia_nombre.trim();
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM ${tFO}
       WHERE empresa_id=$1::uuid AND lower(btrim(nombre)) = lower(btrim($2))
       LIMIT 1`,
      [empresaId, nombre]
    );
    let familiaId = found.rows[0]?.id ?? null;
    if (!familiaId) {
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO ${tFO} (empresa_id, nombre, activo)
         VALUES ($1::uuid, $2, true) RETURNING id`,
        [empresaId, nombre]
      );
      familiaId = ins.rows[0]?.id ?? null;
    }
    if (familiaId) {
      await pool.query(
        `UPDATE ${tP} SET familia_olfativa_id=$1::uuid WHERE id=$2::uuid AND empresa_id=$3::uuid`,
        [familiaId, productoId, empresaId]
      );
    }
  }

  // 2) Notas (top/heart/base): borra las existentes para cada posición y reinserta.
  const posiciones: Array<{ pos: "top" | "heart" | "base"; nombres: string[] }> = [
    { pos: "top", nombres: data.notas_top },
    { pos: "heart", nombres: data.notas_heart },
    { pos: "base", nombres: data.notas_base },
  ];
  for (const { pos, nombres } of posiciones) {
    if (nombres.length === 0) continue;
    // Deduplicar nombres case-insensitive preservando orden.
    const vistos = new Set<string>();
    const limpios: string[] = [];
    for (const raw of nombres) {
      const v = raw.trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (vistos.has(k)) continue;
      vistos.add(k);
      limpios.push(v);
    }
    await pool.query(
      `DELETE FROM ${tPN} WHERE producto_id=$1::uuid AND posicion=$2`,
      [productoId, pos]
    );
    let orden = 1;
    for (const nombre of limpios) {
      if (!nombre) continue;
      const found = await pool.query<{ id: string }>(
        `SELECT id FROM ${tNO}
         WHERE empresa_id=$1::uuid AND lower(btrim(nombre)) = lower(btrim($2))
         LIMIT 1`,
        [empresaId, nombre]
      );
      let notaId = found.rows[0]?.id ?? null;
      if (!notaId) {
        const ins = await pool.query<{ id: string }>(
          `INSERT INTO ${tNO} (empresa_id, nombre, activo)
           VALUES ($1::uuid, $2, true) RETURNING id`,
          [empresaId, nombre]
        );
        notaId = ins.rows[0]?.id ?? null;
      }
      if (notaId) {
        await pool.query(
          `INSERT INTO ${tPN} (producto_id, nota_id, posicion, orden)
           VALUES ($1::uuid, $2::uuid, $3, $4::int)`,
          [productoId, notaId, pos, orden]
        );
        orden++;
      }
    }
  }
}

/** Helper sin uso directo aqui pero util al exponer en templates */
export const PRODUCTOS_TEMPLATE_ROW = {
  NOMBRE: "",
  SKU: "",
  CODIGO_BARRAS: "",
  MARCA: "DIOR",
  "SKU PRODUCT": "SAUVAGE EDP",
  "SKU DESCRIPCION": "EAU DE PARFUM",
  CATEGORIA: "PERFUMERIA",
  GENERO: "HOMBRE",
  VOLUMEN_ML: 100,
  CONCENTRACION: "EDP",
  TIPO_PRESENTACION: "CAJA NORMAL",
  PROVEEDOR_PRINCIPAL: "PROVEEDOR DEMO",
  UBICACION_PRINCIPAL: "DEPOSITO CENTRAL",
  UNIDAD_MEDIDA: "UNIDAD",
  COSTO_PROMEDIO: 10000,
  PRECIO_VENTA: 15000,
  CANTIDAD_MINIMA_MINORISTA: 1,
  PRECIO_VENTA_MAYORISTA: 12000,
  CANTIDAD_MINIMA_MAYORISTA: 3,
  STOCK_ACTUAL: 10,
  STOCK_MINIMO: 2,
  METODO_VALUACION: "CPP",
  ACTIVO: "SI",
  ACORDES_PRINCIPALES: "Cítrico, Amaderado, Fresco",
  FAMILIA_OLFATIVA: "Aromática Fougère",
  NOTAS_SALIDA: "bergamota, pimienta",
  NOTAS_CORAZON: "lavanda, ambroxan",
  NOTAS_FONDO: "vetiver, sándalo",
};
// Util para detectar uso por linter
export const _unused = normalizeUpperNullable;

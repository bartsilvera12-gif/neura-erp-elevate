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
  metodo_valuacion: "CPP" | "FIFO" | "LIFO";
  activo: boolean;
  acordes: string[];
  errors: string[];
  warnings: string[];
  match_id?: string | null;
}

const METODOS = new Set(["CPP", "FIFO", "LIFO"]);

export function parseProductosRows(rows: Record<string, string>[]): ProductoParsed[] {
  return rows.map((r, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const marca = normalizeUpperText(pick(r, "MARCA"));
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
      "CANTIDAD MINIMA MINORISTA",
      "CANTIDAD_MINIMA_V_MINORISTA"
    );
    const cantidad_minima_minorista =
      Number.isFinite(cantMinMinRaw) && cantMinMinRaw >= 1
        ? Math.floor(cantMinMinRaw)
        : null;
    const acordesCsv = pick(r, "ACORDES_PRINCIPALES", "ACORDES", "ACORDES PRINCIPALES", "ACORDES_OLFATIVOS");
    const acordes = acordesCsv
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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
      precio_venta: pickNumber(r, "PRECIO_VENTA"),
      stock_actual: pickNumber(r, "STOCK_ACTUAL"),
      stock_minimo: pickNumber(r, "STOCK_MINIMO"),
      cantidad_minima_minorista,
      metodo_valuacion,
      activo: pickBool(r, "ACTIVO"),
      acordes,
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
}

export async function buildResolverMaps(schemaRaw: string, empresaId: string): Promise<ResolverMaps> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool no disponible.");
  const tP = quoteSchemaTable(schema, "productos");
  const tC = quoteSchemaTable(schema, "categorias_productos");
  const tPr = quoteSchemaTable(schema, "proveedores");
  const tU = quoteSchemaTable(schema, "inventario_ubicaciones");

  const [prods, cats, provs, ubis] = await Promise.all([
    pool.query<ProductoExistente>(`SELECT id, sku, codigo_barras, stock_actual FROM ${tP} WHERE empresa_id=$1::uuid`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tC} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
    pool.query<{ id: string; nombre: string }>(`SELECT id, nombre FROM ${tPr} WHERE empresa_id=$1::uuid`, [empresaId]),
    pool.query<{ id: string; nombre: string; codigo: string | null }>(`SELECT id, nombre, codigo FROM ${tU} WHERE empresa_id=$1::uuid AND activo=true`, [empresaId]),
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
  return { productosBySku, productosByCodigo, categoriasByName, proveedoresByName, ubicacionesByName, ubicacionesByCodigo };
}

export function buildPreview(parsed: ProductoParsed[], maps: ResolverMaps): PreviewResponse {
  const catsFaltantes = new Set<string>();
  const provsFaltantes = new Set<string>();
  const ubisFaltantes = new Set<string>();
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
      },
      movimientos_a_generar: movimientosGenerar,
      unidades_entrada: totalEntrada,
      unidades_salida: totalSalida,
    },
    rows,
    headers: ["NOMBRE","SKU","MODELO","SKU_DESCRIPCION","MARCA","CODIGO_BARRAS","CATEGORIA","PROVEEDOR_PRINCIPAL","UBICACION_PRINCIPAL","UNIDAD_MEDIDA","COSTO_PROMEDIO","PRECIO_VENTA","STOCK_ACTUAL","STOCK_MINIMO","CANTIDAD_MINIMA_MINORISTA","METODO_VALUACION","ACTIVO","ACORDES_PRINCIPALES"],
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
  const tSec = `"${schema.replace(/"/g, '""')}".incrementar_secuencia_producto`;
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

  // Crear faltantes (categorias/proveedores/ubicaciones) si corresponde
  if (crearFaltantes) {
    const cats = new Set<string>();
    const provs = new Set<string>();
    const ubis = new Set<string>();
    for (const p of parsed) {
      if (p.categoria_nombre && !maps.categoriasByName.has(p.categoria_nombre)) cats.add(p.categoria_nombre);
      if (p.proveedor_nombre && !maps.proveedoresByName.has(p.proveedor_nombre)) provs.add(p.proveedor_nombre);
      if (p.ubicacion_nombre && !maps.ubicacionesByName.has(p.ubicacion_nombre) && !maps.ubicacionesByCodigo.has(p.ubicacion_nombre)) ubis.add(p.ubicacion_nombre);
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
               updated_at=now()
             WHERE id=$16::uuid AND empresa_id=$17::uuid`,
            [p.nombre, p.sku, p.modelo, p.codigo_barras, p.unidad_medida, p.costo_promedio, p.precio_venta,
             p.stock_actual, p.stock_minimo, p.cantidad_minima_minorista, p.metodo_valuacion, p.activo,
             categoriaId, proveedorId, ubicacionId, p.match_id, empresaId,
             p.marca, p.descripcion_corta]
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
               marca, descripcion_corta
             ) VALUES (
               $1::uuid, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), $6::boolean,
               $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric,
               $12::int,
               $13, $14::boolean, $15::uuid, $16::uuid, $17::uuid,
               NULLIF($18,''), NULLIF($19,'')
             ) RETURNING id`,
            [empresaId, p.nombre, p.sku, p.modelo, codigoBarras, codigoInterno,
             p.unidad_medida, p.costo_promedio, p.precio_venta, p.stock_actual, p.stock_minimo,
             p.cantidad_minima_minorista,
             p.metodo_valuacion, p.activo, categoriaId, proveedorId, ubicacionId,
             p.marca, p.descripcion_corta]
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

/** Helper sin uso directo aqui pero util al exponer en templates */
export const PRODUCTOS_TEMPLATE_ROW = {
  NOMBRE: "EJEMPLO PRODUCTO",
  SKU: "EJ-001",
  MODELO: "SAUVAGE",
  SKU_DESCRIPCION: "EAU DE PARFUM 100ML",
  MARCA: "DIOR",
  CODIGO_BARRAS: "",
  CATEGORIA: "ELECTRICIDAD",
  PROVEEDOR_PRINCIPAL: "DON HERRAMIENTAS SA",
  UBICACION_PRINCIPAL: "DEPOSITO CENTRAL",
  UNIDAD_MEDIDA: "UNIDAD",
  COSTO_PROMEDIO: 10000,
  PRECIO_VENTA: 15000,
  STOCK_ACTUAL: 10,
  STOCK_MINIMO: 2,
  CANTIDAD_MINIMA_MINORISTA: 1,
  METODO_VALUACION: "CPP",
  ACTIVO: "SI",
  ACORDES_PRINCIPALES: "Cítrico, Amaderado, Fresco",
};
// Util para detectar uso por linter
export const _unused = normalizeUpperNullable;

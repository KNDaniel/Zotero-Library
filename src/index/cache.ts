import { gunzip, gzip } from "zlib";
import { promisify } from "util";
import type { ZoteroApiObject } from "../model/types";
import type { Changes, RawLibrary } from "../source/ZoteroSource";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Súbelo si cambia el formato de la copia: las copias antiguas se descartan. */
export const CACHE_SCHEMA = 1;

export interface CacheMeta {
  schema: number;
  savedAt: number;
  libraryPath: string;
  plugin: string;
}

/** Copia comprimida de la descarga cruda de la biblioteca. */
export async function packCache(raw: RawLibrary, meta: Omit<CacheMeta, "schema">): Promise<Uint8Array> {
  const json = JSON.stringify({ meta: { schema: CACHE_SCHEMA, ...meta }, raw });
  return gzipAsync(Buffer.from(json, "utf8"));
}

/** Lee una copia; devuelve null si está dañada o es de otro formato. */
export async function unpackCache(data: ArrayBuffer | Uint8Array): Promise<{ meta: CacheMeta; raw: RawLibrary } | null> {
  try {
    const text = (await gunzipAsync(Buffer.from(data as ArrayBuffer))).toString("utf8");
    const parsed = JSON.parse(text) as { meta?: CacheMeta; raw?: RawLibrary };
    if (parsed?.meta?.schema !== CACHE_SCHEMA || !Array.isArray(parsed.raw?.entities) || !Array.isArray(parsed.raw?.collections)) return null;
    return { meta: parsed.meta, raw: parsed.raw };
  } catch {
    return null;
  }
}

/** Un objeto marcado como borrado (papelera) en los datos de Zotero. */
const isTrashed = (e: ZoteroApiObject): boolean => {
  const d = (e.data as { deleted?: unknown }).deleted;
  return d === 1 || d === true || d === "1" || d === "true";
};

/**
 * Aplica los cambios a una descarga previa: sustituye por clave lo modificado,
 * retira lo eliminado y lo que pasó a la papelera.
 */
export function mergeChanges(base: RawLibrary, changes: Changes, fallbackVersion = 0): RawLibrary {
  const items = new Map(base.entities.map((e) => [e.key, e]));
  const collections = new Map(base.collections.map((c) => [c.key, c]));
  for (const k of changes.deleted?.items ?? []) items.delete(k);
  for (const k of changes.deleted?.collections ?? []) collections.delete(k);
  for (const e of changes.changed) (isTrashed(e) ? items.delete(e.key) : items.set(e.key, e));
  for (const c of changes.changedCollections) (isTrashed(c) ? collections.delete(c.key) : collections.set(c.key, c));
  return {
    ...base,
    entities: [...items.values()],
    collections: [...collections.values()],
    libraryVersion: changes.libraryVersion || fallbackVersion || base.libraryVersion,
    total: items.size,
    truncated: false,
  };
}

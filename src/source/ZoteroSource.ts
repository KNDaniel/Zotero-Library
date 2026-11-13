import type { ZoteroApiObject } from "../model/types";

export interface PingResult {
  total: number;
  libraryVersion: number;
  apiVersion?: string;
}

/** Por qué vía llegaron las anotaciones */
export type AnnotationSource = "items" | "itemType-filter" | "children" | "none";

export interface RawLibrary {
  /** Ítems, adjuntos, notas y anotaciones tal como los entrega la API */
  entities: ZoteroApiObject[];
  collections: ZoteroApiObject[];
  libraryVersion: number;
  total: number;
  /** true si llegaron menos entidades de las anunciadas */
  truncated: boolean;
  /** Vía por la que se obtuvieron las anotaciones */
  annotationSource?: AnnotationSource;
  /** Adjuntos cuyas anotaciones no se pudieron leer */
  annotationErrors?: number;
  /** "unpaged": una sola respuesta; "paged": por páginas */
  fetchMode?: "unpaged" | "paged";
  /** Peticiones HTTP realizadas durante la carga */
  requests?: number;
  /** Cuándo terminó la última descarga completa (ms desde 1970) */
  fetchedAt?: number;
  /** Cuánto tardó esa descarga (ms) */
  fetchMs?: number;
}

export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * Origen de datos de Zotero. Todo lo que el plugin necesita pasa por aquí, de
 * modo que se pueda sustituir la API local por otra fuente sin tocar el resto.
 */
export interface ZoteroSource {
  ping(): Promise<PingResult>;
  fetchLibrary(onProgress?: ProgressCallback): Promise<RawLibrary>;
}

/** Cambios de la biblioteca desde una versión (sincronización incremental). */
export interface Changes {
  /** Ítems nuevos o modificados (incluye los que pasaron a la papelera, marcados como borrados) */
  changed: ZoteroApiObject[];
  changedCollections: ZoteroApiObject[];
  /** Claves eliminadas; null si la API no ofrece /deleted (hay que recargar todo) */
  deleted: { items: string[]; collections: string[] } | null;
  libraryVersion: number;
}

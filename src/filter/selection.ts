import type { LibraryIndex } from "../index/LibraryIndex";
import type { ZoteroAnnotation, ZoteroItem } from "../model/types";
import type { ContentFilter } from "./content";
import { itemMatches } from "./evaluate";
import { contextOf } from "./fields";
import type { QuerySpec } from "./query";
import { collator } from "./text";

export type TagMatch = "all" | "any";

export interface AvailabilityInput {
  /** Colecciones que limitan la búsqueda; vacío = toda la biblioteca */
  collections: Iterable<string>;
  includeSubcollections: boolean;
  query: QuerySpec;
}

/**
 * Ítems DISPONIBLES: dentro de las colecciones elegidas y que cumplen la búsqueda.
 * Incluye, al final, los adjuntos sin contenedor (ítems sintéticos con `fromAttachment`).
 */
export function availableItems(index: LibraryIndex, input: AvailabilityInput): ZoteroItem[] {
  const collections = [...input.collections];
  const inCollections = collections.length ? index.itemKeysInCollections(collections, input.includeSubcollections) : null;
  const ctx = contextOf(index);
  const out: ZoteroItem[] = [];
  for (const item of [...index.items.values(), ...index.attachmentItems.values()]) {
    if (inCollections && !inCollections.has(item.key)) continue;
    if (itemMatches(item, input.query, ctx)) out.push(item);
  }
  return out;
}

export interface TagEntry {
  tag: string;
  /**
   * Anotaciones que habría si se eligiera esta etiqueta ahora:
   *  - sin etiquetas elegidas: las que la tienen (total);
   *  - con Y: las del resultado actual que la tienen (baja al restringir);
   *  - con O: las del resultado actual más las que ella añade (sube al ampliar).
   */
  count: number;
}

export interface TagPanel {
  tags: TagEntry[];
  /** Etiquetas elegidas que siguen disponibles (las demás se descartan) */
  selected: Set<string>;
}

/** Anotaciones de los ítems seleccionados que pasan la búsqueda de contenido (la base de las etiquetas). */
export function annotationBase(index: LibraryIndex, selectedItemKeys: Iterable<string>, content: ContentFilter | null = null): ZoteroAnnotation[] {
  const out: ZoteroAnnotation[] = [];
  const seen = new Set<string>();
  for (const key of selectedItemKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    for (const a of index.annotationsOf(key)) if (!content || content.matches(a)) out.push(a);
  }
  return out;
}

/**
 * Contadores del panel de etiquetas sobre una base de anotaciones.
 * Con Y el contador baja según la disponibilidad y se ocultan las de 0 (salvo las elegidas); con O no cambia.
 */
export function tagCounts(base: ZoteroAnnotation[], selected: ReadonlySet<string>, match: TagMatch): TagEntry[] {
  const present = new Set<string>();
  const total = new Map<string, number>();
  for (const a of base) for (const t of new Set(a.tags.map((x) => x.tag))) {
    present.add(t);
    total.set(t, (total.get(t) ?? 0) + 1);
  }
  const chosen = new Set([...selected].filter((t) => present.has(t)));
  // Sin etiquetas elegidas, o con O, el contador es el total de cada etiqueta: O ni restringe ni agrega.
  if (chosen.size === 0 || match === "any") return [...total.entries()].map(([tag, count]) => ({ tag, count })).sort(byTag);

  // Con Y: anotaciones del resultado actual (tienen todas las elegidas) que además tienen cada etiqueta.
  const counts = new Map<string, number>();
  for (const a of base) {
    if (!annotationMatchesTags(a, chosen, "all")) continue;
    for (const t of new Set(a.tags.map((x) => x.tag))) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const out: TagEntry[] = [];
  for (const tag of present) {
    const count = counts.get(tag) ?? 0;
    if (count === 0 && !chosen.has(tag)) continue;
    out.push({ tag, count });
  }
  return out.sort(byTag);
}

const byTag = (a: TagEntry, b: TagEntry) => collator.compare(a.tag, b.tag);

export interface TagPanelOptions {
  match?: TagMatch;
  content?: ContentFilter | null;
}

/**
 * Panel de etiquetas. Sin ítems seleccionados está vacío; con ítems solo ofrece
 * las etiquetas de sus anotaciones (las que pasan la búsqueda de contenido). Una
 * etiqueta elegida que deja de estar disponible se deselecciona: no puede haber
 * filtros invisibles.
 */
export function tagPanel(index: LibraryIndex, selectedItemKeys: Iterable<string>, selectedTags: Iterable<string>, options: TagPanelOptions = {}): TagPanel {
  const base = annotationBase(index, selectedItemKeys, options.content ?? null);
  const present = new Set<string>();
  for (const a of base) for (const t of a.tags) present.add(t.tag);
  const selected = new Set([...selectedTags].filter((t) => present.has(t)));
  return { tags: tagCounts(base, selected, options.match ?? "all"), selected };
}

/** Sin etiquetas elegidas pasan todas; Y exige todas; O, alguna. */
export function annotationMatchesTags(a: ZoteroAnnotation, selected: ReadonlySet<string>, match: TagMatch): boolean {
  if (selected.size === 0) return true;
  const own = new Set(a.tags.map((t) => t.tag));
  const wanted = [...selected];
  return match === "all" ? wanted.every((t) => own.has(t)) : wanted.some((t) => own.has(t));
}

export interface ResultSet {
  /** Metadata de TODOS los ítems seleccionados, tengan o no anotaciones */
  items: ZoteroItem[];
  /** Anotaciones que pasan el filtro de etiquetas, por clave de ítem */
  annotations: Map<string, ZoteroAnnotation[]>;
  /** Todas las anotaciones de cada ítem, sin filtrar */
  allAnnotations: Map<string, ZoteroAnnotation[]>;
}

/**
 * Resultado único del que se alimentan los dos modos:
 *  - sin ítems seleccionados no hay nada (aunque haya etiquetas elegidas);
 *  - con ítems: metadata de todos y todas sus anotaciones;
 *  - con ítems y etiquetas: metadata de todos y solo las anotaciones que coinciden.
 * Canal de filtrado de las anotaciones: base (ítems seleccionados) → contenido → etiquetas.
 */
export function computeResults(
  index: LibraryIndex,
  selectedItemKeys: Iterable<string>,
  selectedTags: ReadonlySet<string>,
  match: TagMatch,
  content: ContentFilter | null = null,
): ResultSet {
  const items: ZoteroItem[] = [];
  const annotations = new Map<string, ZoteroAnnotation[]>();
  const allAnnotations = new Map<string, ZoteroAnnotation[]>();
  const seen = new Set<string>();
  for (const key of selectedItemKeys) {
    const item = index.entry(key);
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    const all = index.annotationsOf(key);
    allAnnotations.set(key, all);
    annotations.set(key, all.filter((a) => (!content || content.matches(a)) && annotationMatchesTags(a, selectedTags, match)));
  }
  return { items, annotations, allAnnotations };
}

/** Anotaciones del resultado en el orden de los ítems. */
export function flattenAnnotations(result: ResultSet): ZoteroAnnotation[] {
  return result.items.flatMap((i) => result.annotations.get(i.key) ?? []);
}

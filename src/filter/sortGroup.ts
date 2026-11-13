import { itemTypeLabel } from "../model/itemTypes";
import type { LibraryIndex } from "../index/LibraryIndex";
import { ZOTERO_COLORS } from "../model/colors";
import type { ZoteroAnnotation, ZoteroCreator, ZoteroItem } from "../model/types";
import { collator } from "./text";

export type SortDir = "asc" | "desc";
export type ItemSortKey = "date" | "author" | "title" | "itemType" | "dateAdded";
export type AnnotationSortKey = "page" | "dateAdded" | "color" | "item";
export type ItemGroupKey = "none" | "collection" | "itemType" | "author" | "year";
export type AnnotationGroupKey = "none" | "item" | "color" | "tag";

export interface Group<T> {
  key: string;
  label: string;
  entries: T[];
}

export const NO_GROUP_LABELS = {
  collection: "(sin colección)",
  author: "(sin autor)",
  year: "(sin fecha)",
  tag: "(sin etiqueta)",
  color: "(sin color)",
} as const;

/** Autor principal: el primer creador de tipo autor, o el primero que haya. */
export function primaryCreator(item: ZoteroItem): ZoteroCreator | undefined {
  return item.creators.find((c) => c.creatorType === "author") ?? item.creators[0];
}

const creatorLabel = (c: ZoteroCreator | undefined): string => (c ? (c.lastName ?? c.name ?? "") : "");

/** Ordena por una clave de texto; los valores ausentes van siempre al final. */
function sortBy<T>(list: T[], keyOf: (t: T) => string | undefined, dir: SortDir, tie?: (a: T, b: T) => number): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return list
    .map((t, i) => ({ t, i, k: keyOf(t) }))
    .sort((a, b) => {
      const aMissing = a.k === undefined || a.k === "";
      const bMissing = b.k === undefined || b.k === "";
      if (aMissing || bMissing) return aMissing === bMissing ? a.i - b.i : aMissing ? 1 : -1;
      const c = collator.compare(a.k!, b.k!) * sign;
      if (c !== 0) return c;
      const t2 = tie ? tie(a.t, b.t) : 0;
      return t2 !== 0 ? t2 : a.i - b.i;
    })
    .map((x) => x.t);
}

export function sortItems(items: ZoteroItem[], key: ItemSortKey, dir: SortDir = "asc"): ZoteroItem[] {
  const byTitle = (a: ZoteroItem, b: ZoteroItem) => collator.compare(a.title, b.title);
  switch (key) {
    case "date":
      return sortBy(items, (i) => i.isoDate, dir, byTitle);
    case "author":
      return sortBy(items, (i) => creatorLabel(primaryCreator(i)), dir, byTitle);
    case "title":
      return sortBy(items, (i) => i.title, dir);
    case "itemType":
      return sortBy(items, (i) => itemTypeLabel(i.itemType), dir, byTitle);
    case "dateAdded":
      return sortBy(items, (i) => i.dateAdded, dir, byTitle);
  }
}

const COLOR_ORDER = Object.keys(ZOTERO_COLORS);

export function sortAnnotations(
  index: LibraryIndex,
  annotations: ZoteroAnnotation[],
  key: AnnotationSortKey,
  dir: SortDir = "asc",
): ZoteroAnnotation[] {
  switch (key) {
    case "page": {
      // Orden de lectura (sortIndex de Zotero) dentro de cada ítem; los ítems conservan su orden.
      if (dir === "asc") return [...annotations];
      const byItem = new Map<string, ZoteroAnnotation[]>();
      for (const a of annotations) {
        const k = index.itemKeyOf(a) ?? a.parentKey;
        byItem.set(k, [...(byItem.get(k) ?? []), a]);
      }
      return [...byItem.values()].flatMap((list) => list.reverse());
    }
    case "dateAdded":
      return sortBy(annotations, (a) => a.dateAdded, dir);
    case "color": {
      const rank = (a: ZoteroAnnotation) => {
        const i = COLOR_ORDER.indexOf(a.colorCategory);
        return i < 0 ? undefined : String(i).padStart(2, "0");
      };
      return sortBy(annotations, rank, dir);
    }
    case "item": {
      const title = (a: ZoteroAnnotation) => {
        const k = index.itemKeyOf(a);
        return k ? (index.items.get(k)?.title ?? index.attachments.get(k)?.title) : undefined;
      };
      return sortBy(annotations, title, dir);
    }
  }
}

function pushGroup<T>(groups: Map<string, Group<T>>, key: string, label: string, entry: T): void {
  const g = groups.get(key) ?? { key, label, entries: [] };
  g.entries.push(entry);
  groups.set(key, g);
}

/** Ordena grupos por etiqueta; el grupo «sin valor» va siempre al final. */
function orderGroups<T>(groups: Map<string, Group<T>>, emptyKey: string | null): Group<T>[] {
  return [...groups.values()].sort((a, b) => {
    if (a.key === emptyKey) return 1;
    if (b.key === emptyKey) return -1;
    return collator.compare(a.label, b.label);
  });
}

export function groupItems(index: LibraryIndex, items: ZoteroItem[], by: ItemGroupKey): Group<ZoteroItem>[] {
  if (by === "none") return [{ key: "", label: "", entries: items }];
  const groups = new Map<string, Group<ZoteroItem>>();
  const EMPTY = "\u0000sin-valor";
  for (const item of items) {
    switch (by) {
      case "collection":
        if (!item.collections.length) pushGroup(groups, EMPTY, NO_GROUP_LABELS.collection, item);
        for (const c of item.collections) pushGroup(groups, c, index.collections.get(c)?.name ?? c, item);
        break;
      case "itemType":
        pushGroup(groups, item.itemType, itemTypeLabel(item.itemType), item);
        break;
      case "author": {
        const label = creatorLabel(primaryCreator(item));
        label ? pushGroup(groups, label, label, item) : pushGroup(groups, EMPTY, NO_GROUP_LABELS.author, item);
        break;
      }
      case "year":
        item.year !== undefined ? pushGroup(groups, String(item.year), String(item.year), item) : pushGroup(groups, EMPTY, NO_GROUP_LABELS.year, item);
        break;
    }
  }
  return orderGroups(groups, EMPTY);
}

export function groupAnnotations(index: LibraryIndex, annotations: ZoteroAnnotation[], by: AnnotationGroupKey): Group<ZoteroAnnotation>[] {
  if (by === "none") return [{ key: "", label: "", entries: annotations }];
  const groups = new Map<string, Group<ZoteroAnnotation>>();
  const EMPTY = "\u0000sin-valor";
  for (const a of annotations) {
    switch (by) {
      case "item": {
        const k = index.itemKeyOf(a) ?? a.parentKey;
        const label = index.items.get(k)?.title ?? index.attachments.get(k)?.title ?? k;
        pushGroup(groups, k, label, a);
        break;
      }
      case "color":
        a.colorCategory ? pushGroup(groups, a.colorCategory, a.colorCategory, a) : pushGroup(groups, EMPTY, NO_GROUP_LABELS.color, a);
        break;
      case "tag":
        // Una anotación con varias etiquetas aparece en cada uno de sus grupos.
        if (!a.tags.length) pushGroup(groups, EMPTY, NO_GROUP_LABELS.tag, a);
        for (const t of new Set(a.tags.map((x) => x.tag))) pushGroup(groups, t, t, a);
        break;
    }
  }
  if (by === "item") return [...groups.values()]; // orden de aparición = orden de los ítems
  if (by === "color") {
    return [...groups.values()].sort((a, b) => {
      const ra = a.key === EMPTY ? 99 : COLOR_ORDER.indexOf(a.key);
      const rb = b.key === EMPTY ? 99 : COLOR_ORDER.indexOf(b.key);
      return (ra < 0 ? 98 : ra) - (rb < 0 ? 98 : rb);
    });
  }
  return orderGroups(groups, EMPTY);
}

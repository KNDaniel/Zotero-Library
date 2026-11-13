import { buildContentFilter, type ContentScope } from "../filter/content";
import { knownFieldNames } from "../filter/fields";
import type { Condition, QuerySpec } from "../filter/query";
import { parseQuery } from "../filter/query";
import {
  availableItems,
  computeResults,
  flattenAnnotations,
  tagPanel,
  type ResultSet,
  type TagMatch,
  type TagPanel,
} from "../filter/selection";
import {
  groupAnnotations,
  groupItems,
  sortAnnotations,
  sortItems,
  type AnnotationGroupKey,
  type AnnotationSortKey,
  type Group,
  type ItemGroupKey,
  type ItemSortKey,
  type SortDir,
} from "../filter/sortGroup";
import { collator, norm } from "../filter/text";
import type { LibraryIndex } from "../index/LibraryIndex";
import type { ZoteroAnnotation, ZoteroItem } from "../model/types";
import type { OutputKind } from "../output/build";

export type ViewMode = "item" | "annotation";

export interface ViewState {
  // --- Panel de ítems ---
  collections: string[];
  includeSubcollections: boolean;
  searchMode: "simple" | "complex";
  searchText: string;
  complexConditions: Condition[];
  /** Y / O de la búsqueda de ítems (alternativos) */
  combine: "and" | "or";
  /** Ítems marcados en la lista (no se guardan entre sesiones) */
  selectedItems: string[];
  /**
   * Tarjetas marcadas con doble clic para la salida (no se guardan entre sesiones).
   * Duran hasta que se deselecciona su ítem en el panel de ítems; cambiar de modo, de
   * etiquetas o de búsqueda de contenido no las borra. Cada modo tiene las suyas.
   */
  markedItems: string[];
  markedAnnotations: string[];
  /** Lista de ítems: orden, agrupación y formato de fila propios (independientes de los de resultados) */
  listSort: { key: ItemSortKey; dir: SortDir };
  listGroup: ItemGroupKey;
  /** Formato de fila: vacío = el de los ajustes; «builtin:<id>» = uno incluido; si no, ruta de una plantilla */
  rowFormat: string;
  // --- Panel de etiquetas ---
  tagSearch: string;
  selectedTags: string[];
  /** Coincidencia total (Y) o parcial (O) */
  tagMatch: TagMatch;
  // --- Panel de resultados ---
  mode: ViewMode;
  /** Búsqueda de contenido de las anotaciones: palabras separadas = todas; | separa alternativas */
  contentSearch: string;
  contentScope: ContentScope;
  itemSort: { key: ItemSortKey; dir: SortDir };
  annotationSort: { key: AnnotationSortKey; dir: SortDir };
  itemGroup: ItemGroupKey;
  annotationGroup: AnnotationGroupKey;
  // --- Salida (copiar, insertar, nueva nota) ---
  outputKind: OutputKind;
  /** Plantilla elegida para cada tipo de salida; vacío = la de los ajustes */
  outputTemplates: Record<OutputKind, string>;
  /** Estilo bibliográfico; vacío = el de los ajustes */
  outputStyle: string;
}

export function defaultViewState(): ViewState {
  return {
    collections: [],
    includeSubcollections: true,
    searchMode: "simple",
    searchText: "",
    complexConditions: [],
    combine: "and",
    selectedItems: [],
    markedItems: [],
    markedAnnotations: [],
    listSort: { key: "author", dir: "asc" },
    listGroup: "none",
    rowFormat: "",
    tagSearch: "",
    selectedTags: [],
    tagMatch: "all",
    mode: "item",
    contentSearch: "",
    contentScope: "both",
    itemSort: { key: "author", dir: "asc" },
    annotationSort: { key: "page", dir: "asc" },
    itemGroup: "none",
    annotationGroup: "none",
    outputKind: "full",
    outputTemplates: { full: "", meta: "", annotations: "", bibliography: "", link: "" },
    outputStyle: "",
  };
}

/** Lo que se recuerda entre sesiones: todo menos la selección de ítems y etiquetas. */
export function persistableState(s: ViewState): Partial<ViewState> {
  const { selectedItems: _items, markedItems: _mi, markedAnnotations: _ma, selectedTags: _tags, tagSearch: _search, contentSearch: _content, ...rest } = s;
  return rest;
}

export function restoreState(saved: Partial<ViewState> | undefined): ViewState {
  const base = defaultViewState();
  return {
    ...base,
    ...(saved ?? {}),
    // se completa lo que falte (p. ej. una copia guardada por una versión anterior)
    outputTemplates: { ...base.outputTemplates, ...(saved?.outputTemplates ?? {}) },
    selectedItems: [],
    markedItems: [],
    markedAnnotations: [],
    selectedTags: [],
    tagSearch: "",
    contentSearch: "",
  };
}

const needsValue = (c: Condition) => c.op !== "empty";

/** Una fila del modo complejo cuenta solo si está completa. */
export function isCompleteCondition(c: Condition): boolean {
  if (!needsValue(c)) return true;
  if (c.value.trim() === "") return false;
  return c.op !== "between" || (c.value2 ?? "").trim() !== "";
}

export function buildQuery(state: ViewState, known?: Set<string>): { spec: QuerySpec; warnings: string[] } {
  if (state.searchMode === "complex") {
    return { spec: { mode: state.combine, conditions: state.complexConditions.filter(isCompleteCondition) }, warnings: [] };
  }
  return parseQuery(state.searchText, state.combine, known);
}

export interface Derived {
  spec: QuerySpec;
  warnings: string[];
  /** Ítems disponibles (colecciones + búsqueda), ya ordenados; los adjuntos sin contenedor van al final */
  available: ZoteroItem[];
  /** Lista de ítems: los ítems reales agrupados según `listGroup` */
  listGroups: Group<ZoteroItem>[];
  /** Lista de ítems: adjuntos sin contenedor disponibles (ítems sintéticos) */
  listAttachments: ZoteroItem[];
  /**
   * Ítems seleccionados que siguen existiendo en la biblioteca. La selección sobrevive a cualquier
   * búsqueda o límite de colección: estos solo cambian qué ítems se ven, no cuáles están elegidos.
   * Primero van los que se ven (en el orden de la lista) y después los que quedan fuera.
   */
  selectedItems: string[];
  /** Los seleccionados que la búsqueda o las colecciones dejan fuera de la lista (siguen contando) */
  selectedHidden: ZoteroItem[];
  /** Marcas depuradas: solo de ítems que siguen seleccionados (las de anotaciones, por su ítem) */
  markedItems: string[];
  markedAnnotations: string[];
  /**
   * Anotaciones marcadas con el orden y la agrupación de los resultados. Cuentan para la salida
   * aunque los filtros de etiquetas o de contenido las oculten.
   */
  markedAnnotationList: ZoteroAnnotation[];
  markedAnnotationGroups: Group<ZoteroAnnotation>[];
  /** Las anotaciones que se ven más las marcadas que los filtros ocultan, en el orden de los resultados */
  annotationsPlusMarked: ZoteroAnnotation[];
  tags: TagPanel;
  selectedTags: Set<string>;
  results: ResultSet;
  /** Modo ítem */
  itemGroups: Group<ZoteroItem>[];
  /** Modo anotación */
  annotations: ZoteroAnnotation[];
  annotationGroups: Group<ZoteroAnnotation>[];
}

/**
 * Todo lo que se ve se deduce del estado: no hay filtros invisibles (la
 * selección de ítems solo se depura contra lo que existe; la de etiquetas, contra lo disponible).
 */
export function derive(index: LibraryIndex, state: ViewState): Derived {
  const { spec, warnings } = buildQuery(state, knownFieldNames(index));
  const everything = availableItems(index, { collections: state.collections, includeSubcollections: state.includeSubcollections, query: spec });
  // Los ítems reales primero (con el orden de la lista) y los adjuntos sin contenedor al final.
  const real = sortItems(everything.filter((i) => !i.fromAttachment), state.listSort.key, state.listSort.dir);
  const listAttachments = sortItems(everything.filter((i) => i.fromAttachment), "title", "asc");
  const available = [...real, ...listAttachments];
  const availableKeys = new Set(available.map((i) => i.key));
  const wanted = new Set(state.selectedItems);
  const visibleSelected = available.filter((i) => wanted.has(i.key)).map((i) => i.key);
  // Los que quedan fuera de lo disponible se conservan mientras existan en la biblioteca (una sincronización puede retirarlos).
  const selectedHidden: ZoteroItem[] = [];
  const seenHidden = new Set<string>();
  for (const k of state.selectedItems) {
    if (availableKeys.has(k) || seenHidden.has(k)) continue;
    const it = index.entry(k);
    if (it) {
      seenHidden.add(k);
      selectedHidden.push(it);
    }
  }
  const selectedItems = [...visibleSelected, ...selectedHidden.map((i) => i.key)];

  // Las marcas duran lo que dure la selección de su ítem.
  const selected = new Set(selectedItems);
  const markedItems = state.markedItems.filter((k) => selected.has(k));
  const markedAnnotations = state.markedAnnotations.filter((k) => {
    const a = index.annotations.get(k);
    const owner = a ? index.itemKeyOf(a) : null;
    return owner !== null && selected.has(owner);
  });

  // Canal de filtrado de anotaciones: base (ítems seleccionados) → contenido → etiquetas.
  const content = buildContentFilter(state.contentSearch, state.contentScope);
  const tags = tagPanel(index, selectedItems, state.selectedTags, { match: state.tagMatch, content });
  const raw = computeResults(index, selectedItems, tags.selected, state.tagMatch, content);
  // Los resultados tienen su propio orden, independiente del de la lista.
  const results: ResultSet = { ...raw, items: sortItems(raw.items, state.itemSort.key, state.itemSort.dir) };

  const listGroups = groupItems(index, real, state.listGroup);
  const itemGroups = groupItems(index, results.items, state.itemGroup);
  const annotations = sortAnnotations(index, flattenAnnotations(results), state.annotationSort.key, state.annotationSort.dir);
  const annotationGroups = groupAnnotations(index, annotations, state.annotationGroup);

  // Las anotaciones marcadas cuentan se vean o no: si los filtros ocultan alguna, se recompone
  // la lista con ellas respetando el mismo orden de lectura (ítems en su orden, sortIndex dentro de cada uno).
  const shown = new Set(annotations.map((a) => a.key));
  let annotationsPlusMarked = annotations;
  if (markedAnnotations.some((k) => !shown.has(k))) {
    const everything = computeResults(index, selectedItems, new Set(), state.tagMatch, null);
    const full: ResultSet = { ...everything, items: sortItems(everything.items, state.itemSort.key, state.itemSort.dir) };
    const keep = new Set([...shown, ...markedAnnotations]);
    annotationsPlusMarked = sortAnnotations(index, flattenAnnotations(full).filter((a) => keep.has(a.key)), state.annotationSort.key, state.annotationSort.dir);
  }
  const markedSet = new Set(markedAnnotations);
  const markedAnnotationList = annotationsPlusMarked.filter((a) => markedSet.has(a.key));
  const markedAnnotationGroups = markedAnnotationList.length ? groupAnnotations(index, markedAnnotationList, state.annotationGroup) : [];

  return { spec, warnings, available, listGroups, listAttachments, selectedItems, selectedHidden, markedItems, markedAnnotations, markedAnnotationList, markedAnnotationGroups, annotationsPlusMarked, tags, selectedTags: tags.selected, results, itemGroups, annotations, annotationGroups };
}

export interface TagRow {
  tag: string;
  count: number;
  selected: boolean;
}

/** Etiquetas visibles en el panel: filtradas por el buscador, las elegidas primero. */
export function visibleTags(panel: TagPanel, selected: ReadonlySet<string>, search: string): TagRow[] {
  const q = norm(search);
  return panel.tags
    .filter((t) => !q || norm(t.tag).includes(q))
    .map((t) => ({ ...t, selected: selected.has(t.tag) }))
    .sort((a, b) => (a.selected === b.selected ? collator.compare(a.tag, b.tag) : a.selected ? -1 : 1));
}

export function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

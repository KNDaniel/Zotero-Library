import type { AnnotationGroupKey, AnnotationSortKey, ItemGroupKey, ItemSortKey } from "../filter/sortGroup";

export const ITEM_SORTS: Array<{ value: ItemSortKey; label: string }> = [
  { value: "author", label: "Autor" },
  { value: "date", label: "Fecha de publicación" },
  { value: "title", label: "Título" },
  { value: "itemType", label: "Tipo" },
  { value: "dateAdded", label: "Añadido a Zotero" },
];
export const ANNOTATION_SORTS: Array<{ value: AnnotationSortKey; label: string }> = [
  { value: "page", label: "Orden de lectura" },
  { value: "dateAdded", label: "Creada en Zotero" },
  { value: "color", label: "Color" },
  { value: "item", label: "Ítem" },
];
export const ITEM_GROUPS: Array<{ value: ItemGroupKey; label: string }> = [
  { value: "none", label: "Sin agrupar" },
  { value: "collection", label: "Por colección" },
  { value: "itemType", label: "Por tipo" },
  { value: "author", label: "Por autor" },
  { value: "year", label: "Por año" },
];
export const ANNOTATION_GROUPS: Array<{ value: AnnotationGroupKey; label: string }> = [
  { value: "none", label: "Sin agrupar" },
  { value: "item", label: "Por ítem" },
  { value: "color", label: "Por color" },
  { value: "tag", label: "Por etiqueta" },
];

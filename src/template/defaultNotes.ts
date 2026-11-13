import { DEFAULT_ANNOTATION_RENDER, DEFAULT_ITEM_RENDER, DEFAULT_PRINT_ANNOTATIONS, DEFAULT_PRINT_FULL, DEFAULT_PRINT_META } from "./defaults";
import { ROW_FORMATS } from "./rowFormats";

/**
 * Plantillas por defecto que se pueden volcar a una nota para editarlas: ítem, anotación,
 * las tres de impresión con plantilla (la bibliografía la formatea Zotero) y los formatos de fila incluidos.
 */
export interface DefaultTemplateEntry {
  id: string;
  group: "Renderizado" | "Impresión" | "Formato de fila";
  label: string;
  /** Nombre de la nota que se crea, en la raíz de la bóveda */
  fileName: string;
  /** Contenido tal cual: la plantilla Nunjucks sin añadidos */
  source: string;
}

/** Quita lo que Obsidian no admite en el nombre de una nota. */
export const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim();

export function defaultTemplateEntries(): DefaultTemplateEntry[] {
  return [
    { id: "item", group: "Renderizado", label: "Ítems (tarjetas)", fileName: "Plantilla ítem (por defecto).md", source: DEFAULT_ITEM_RENDER },
    { id: "annotation", group: "Renderizado", label: "Anotaciones (tarjetas)", fileName: "Plantilla anotación (por defecto).md", source: DEFAULT_ANNOTATION_RENDER },
    { id: "printFull", group: "Impresión", label: "Metadata + anotaciones", fileName: "Plantilla impresión completa (por defecto).md", source: DEFAULT_PRINT_FULL },
    { id: "printMeta", group: "Impresión", label: "Solo metadata", fileName: "Plantilla impresión metadata (por defecto).md", source: DEFAULT_PRINT_META },
    { id: "printAnnotations", group: "Impresión", label: "Solo anotaciones", fileName: "Plantilla impresión anotaciones (por defecto).md", source: DEFAULT_PRINT_ANNOTATIONS },
    ...ROW_FORMATS.map((f) => ({
      id: `row:${f.id}`,
      group: "Formato de fila" as const,
      label: f.label,
      fileName: `${safeFileName(`Plantilla formato de fila - ${f.label}`)} (por defecto).md`,
      source: f.source,
    })),
  ];
}

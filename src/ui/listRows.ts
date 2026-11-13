import type { ZoteroItem } from "../model/types";
import type { Derived } from "./state";

/** Identificadores de las secciones fijas de la lista. */
export const SELECTED_SECTION = "section:selected";
export const ATTACHMENTS_SECTION = "section:attachments";
export const ATTACHMENTS_LABEL = "Adjuntos sin contenedor";

export type ListRow =
  | { type: "header"; id: string; label: string; count: number; collapsed: boolean; kind: "selected" | "group" | "attachments"; /** claves de los ítems de la sección (para la casilla de la cabecera) */ keys: string[] }
  | { type: "item"; item: ZoteroItem; section: string; /** seleccionado, pero fuera de la búsqueda o de las colecciones elegidas */ hidden?: boolean; /** último ítem de la sección «Seleccionados» (lleva el separador) */ last?: boolean };

/**
 * Filas de la lista de ítems:
 *  1. «Seleccionados» arriba de todo (plegable), con los ítems elegidos;
 *  2. los grupos de ítems reales (o la lista plana si no hay agrupación);
 *  3. «Adjuntos sin contenedor» siempre al final.
 * Los seleccionados también aparecen, marcados, en su grupo.
 * `collapsed` contiene los ids de secciones plegadas; el plegado no se recuerda entre sesiones
 * (el panel de ítems arranca con «Seleccionados» plegado).
 */
export function buildListRows(d: Derived, collapsed: ReadonlySet<string>): ListRow[] {
  const rows: ListRow[] = [];
  const byKey = new Map(d.available.map((i) => [i.key, i]));
  const selected = d.selectedItems.map((k) => byKey.get(k)).filter((i): i is ZoteroItem => !!i);
  const outside = d.selectedHidden ?? [];

  if (selected.length + outside.length) {
    const isCollapsed = collapsed.has(SELECTED_SECTION);
    rows.push({ type: "header", id: SELECTED_SECTION, label: "Seleccionados", count: selected.length + outside.length, collapsed: isCollapsed, kind: "selected", keys: [...selected, ...outside].map((i) => i.key) });
    if (!isCollapsed) {
      for (const item of selected) rows.push({ type: "item", item, section: SELECTED_SECTION });
      for (const item of outside) rows.push({ type: "item", item, section: SELECTED_SECTION, hidden: true });
      const lastRow = rows[rows.length - 1];
      if (lastRow?.type === "item") lastRow.last = true;
    }
  }

  for (const g of d.listGroups) {
    if (!g.entries.length) continue;
    if (g.label === "") {
      for (const item of g.entries) rows.push({ type: "item", item, section: "" });
      continue;
    }
    const id = `group:${g.key}`;
    const isCollapsed = collapsed.has(id);
    rows.push({ type: "header", id, label: g.label, count: g.entries.length, collapsed: isCollapsed, kind: "group", keys: g.entries.map((i) => i.key) });
    if (!isCollapsed) for (const item of g.entries) rows.push({ type: "item", item, section: id });
  }

  if (d.listAttachments.length) {
    const isCollapsed = collapsed.has(ATTACHMENTS_SECTION);
    rows.push({ type: "header", id: ATTACHMENTS_SECTION, label: ATTACHMENTS_LABEL, count: d.listAttachments.length, collapsed: isCollapsed, kind: "attachments", keys: d.listAttachments.map((i) => i.key) });
    if (!isCollapsed) for (const item of d.listAttachments) rows.push({ type: "item", item, section: ATTACHMENTS_SECTION });
  }
  return rows;
}

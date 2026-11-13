import { childNodes, pathExpression, previewOf, rootNodes, searchNodes, templateVariable, valueText, type ExplorerNode } from "../explorer/tree";
import { norm } from "../filter/text";
import { Floating } from "./floating";

/** Lo que el explorador necesita saber de la biblioteca (lo aporta el plugin). */
export interface ExplorerSource {
  itemLabel(itemKey: string): string;
  /** Contexto de una plantilla de ítem, con todas las anotaciones del ítem */
  itemContext(itemKey: string): Record<string, unknown> | null;
  /** Todos los ítems de la biblioteca, para el selector */
  libraryItems(): Array<{ key: string; label: string }>;
  /** El ítem al que pertenece una anotación (si se abre desde una tarjeta de anotación se explora su ítem completo) */
  itemKeyOfAnnotation(annotationKey: string): string | null;
}

/** Qué se copió: la variable (`{{ title }}`) o su valor (el texto de `title`). */
export type CopyKind = "variable" | "valor";

export interface ExplorerStart {
  kind: "item" | "annotation";
  key: string;
  /** Ítems seleccionados en la vista: van primero en el selector */
  selectedKeys?: string[];
}

/** Cuántos ítems como máximo se listan a la vez en el selector (el buscador filtra el resto). */
export const PICKER_LIMIT = 200;

/** Hijos que se dibujan de golpe en un nodo con muchos (listas de anotaciones, etc.). */
export const EXPLORER_PAGE = 100;

/**
 * Árbol con buscador de todas las variables de una plantilla de ítem (con todas sus anotaciones). Arriba, un selector con
 * buscador sobre toda la biblioteca para cambiar de ítem sin salir de la ventana. Un clic en una variable copia
 * `{{ variable }}`. Solo DOM: lo envuelve un modal de Obsidian.
 */
export class DataExplorer {
  readonly el: HTMLElement;
  private itemKey: string;
  private readonly selectedKeys: Set<string>;
  private readonly pickBtn: HTMLElement;
  private readonly pickLabel: HTMLElement;
  private readonly pickFloat: Floating;
  private readonly pickSearch: HTMLInputElement;
  private readonly pickList: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly note: HTMLElement;
  private readonly tree: HTMLElement;
  private ctx: Record<string, unknown> = {};
  private choices: Array<{ key: string; label: string; folded: string }> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly source: ExplorerSource,
    private readonly onCopy: (text: string, what: CopyKind) => void,
    start: ExplorerStart,
  ) {
    this.el = parent.createDiv({ cls: "zl-explorer" });
    this.selectedKeys = new Set(start.selectedKeys ?? []);

    // Selector de ítem: botón con el ítem actual y, al pulsarlo, un desplegable con buscador
    this.pickBtn = this.el.createEl("button", { cls: "zl-ex-pick", attr: { type: "button", title: "Cambiar de ítem" } });
    this.pickLabel = this.pickBtn.createSpan({ cls: "zl-ex-head" });
    this.pickBtn.createSpan({ cls: "zl-coll-chevron", text: "▾" });
    const box = this.el.ownerDocument.createElement("div");
    box.className = "zl-ex-picker";
    this.pickSearch = box.createEl("input", { cls: "zl-ex-pick-search", type: "search", placeholder: "Buscar ítem…" });
    this.pickSearch.addEventListener("input", () => this.drawPicker());
    this.pickList = box.createDiv({ cls: "zl-ex-pick-list" });
    this.pickFloat = new Floating(this.pickBtn, box, { cls: "zl-float-explorer", maxHeight: 360, minWidth: 320, onClose: () => (this.pickSearch.value = "") });
    this.pickBtn.addEventListener("click", () => {
      this.pickFloat.toggle();
      if (this.pickFloat.isOpen) {
        this.drawPicker();
        this.pickFloat.place();
        this.pickSearch.focus();
      }
    });

    this.search = this.el.createEl("input", { cls: "zl-ex-search", type: "search", placeholder: "Buscar variables o valores…" });
    this.search.addEventListener("input", () => this.draw());
    this.note = this.el.createDiv({ cls: "zl-ex-note" });
    this.tree = this.el.createDiv({ cls: "zl-ex-tree" });
    this.el.createDiv({ cls: "zl-ex-hint", text: "Clic en el nombre: copia {{ variable }}. Clic en el valor: copia solo el valor. El triángulo despliega sus datos." });

    // Desde una anotación se explora su ítem completo (la anotación queda dentro de `annotations`)
    this.itemKey = start.kind === "annotation" ? (source.itemKeyOfAnnotation(start.key) ?? "") : start.key;
    this.refresh();
  }

  /** Foco en el buscador (al abrir el modal). */
  focus(): void {
    this.search.focus();
  }

  /** Retira el desplegable del selector (al cerrar el modal). */
  destroy(): void {
    this.pickFloat.destroy();
  }

  /** Ítems del selector: los seleccionados en la vista primero y después el resto de la biblioteca, por nombre. */
  private pickerChoices(): Array<{ key: string; label: string; folded: string }> {
    if (!this.choices) {
      const all = this.source.libraryItems().map((i) => ({ ...i, folded: norm(i.label) }));
      const rank = (k: string): number => (this.selectedKeys.has(k) ? 0 : 1);
      this.choices = all.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "es"));
    }
    return this.choices;
  }

  private drawPicker(): void {
    this.pickList.empty();
    const words = norm(this.pickSearch.value).split(/\s+/).filter(Boolean);
    const matches = this.pickerChoices().filter((c) => words.every((w) => c.folded.includes(w)));
    for (const c of matches.slice(0, PICKER_LIMIT)) {
      const row = this.pickList.createDiv({ cls: "zl-ex-pick-item", text: c.label, attr: { title: c.label } });
      row.toggleClass("is-selected-item", this.selectedKeys.has(c.key));
      row.toggleClass("is-current", c.key === this.itemKey);
      // mousedown y no click: se elige antes de que el buscador pierda el foco
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.pickItem(c.key);
      });
    }
    if (matches.length === 0) this.pickList.createDiv({ cls: "zl-empty", text: "Ningún ítem coincide." });
    else if (matches.length > PICKER_LIMIT) this.pickList.createDiv({ cls: "zl-ex-hint", text: `Se muestran ${PICKER_LIMIT} de ${matches.length}; escribe para afinar la búsqueda.` });
  }

  private pickItem(key: string): void {
    this.pickFloat.close();
    if (key === this.itemKey) return;
    this.itemKey = key;
    this.search.value = "";
    this.refresh();
  }

  /** Recalcula el contexto del ítem elegido. */
  private refresh(): void {
    this.pickLabel.setText(this.itemKey ? this.source.itemLabel(this.itemKey) : "(sin ítem)");
    this.ctx = (this.itemKey && this.source.itemContext(this.itemKey)) || {};
    this.draw();
  }

  private draw(): void {
    this.tree.empty();
    this.note.setText("");
    if (!Object.keys(this.ctx).length) {
      this.tree.createDiv({ cls: "zl-empty", text: "No hay datos para este ítem." });
      return;
    }
    const q = this.search.value.trim();
    if (!q) {
      for (const n of rootNodes(this.ctx)) this.renderNode(this.tree, n, 0);
      return;
    }
    const { nodes, truncated } = searchNodes(this.ctx, q);
    this.note.setText(nodes.length ? `${nodes.length}${truncated ? "+" : ""} coincidencias${truncated ? " (se muestran las primeras; afina la búsqueda)" : ""}` : "Sin coincidencias.");
    for (const n of nodes) this.renderFlat(n);
  }

  /** Fila de la búsqueda: ruta completa y valor, sin sangrías. */
  private renderFlat(n: ExplorerNode): void {
    const row = this.tree.createDiv({ cls: "zl-ex-row is-flat", attr: { "data-path": pathExpression(n.path) } });
    row.createSpan({ cls: "zl-ex-key", text: pathExpression(n.path), attr: { title: `Copiar ${templateVariable(n.path)}` } });
    this.valueCell(row, n);
    row.addEventListener("click", () => this.copy(templateVariable(n.path), "variable"));
  }

  /** Celda del valor: un clic copia solo el valor, sin disparar el de la fila (que copia la variable). */
  private valueCell(row: HTMLElement, n: ExplorerNode): void {
    const cell = row.createSpan({ cls: `zl-ex-val is-${n.kind}`, text: previewOf(n.value), attr: { title: "Copiar el valor" } });
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      this.copy(valueText(n.value), "valor");
    });
  }

  /** Copia, salvo que el usuario esté seleccionando texto a mano (arrastrar para seleccionar no debe copiar). */
  private copy(text: string, what: CopyKind): void {
    const selected = this.el.ownerDocument.defaultView?.getSelection?.()?.toString() ?? "";
    if (selected.trim()) return;
    this.onCopy(text, what);
  }

  private renderNode(parent: HTMLElement, n: ExplorerNode, depth: number): void {
    const wrap = parent.createDiv({ cls: "zl-ex-node" });
    const row = wrap.createDiv({ cls: "zl-ex-row", attr: { "data-path": pathExpression(n.path) } });
    row.style.paddingLeft = `${depth * 14 + 4}px`;
    const toggle = row.createSpan({ cls: "zl-ex-toggle", text: n.size > 0 ? "▸" : "" });
    row.createSpan({ cls: "zl-ex-key", text: n.label, attr: { title: `Copiar ${templateVariable(n.path)}` } });
    this.valueCell(row, n);
    row.addEventListener("click", () => this.copy(templateVariable(n.path), "variable"));
    if (n.size === 0) return;

    let box: HTMLElement | null = null;
    toggle.addEventListener("click", (e) => {
      e.stopPropagation(); // el triángulo despliega; no copia
      let open: boolean;
      if (!box) {
        // Primera vez: se dibujan los hijos y quedan visibles.
        box = wrap.createDiv({ cls: "zl-ex-children" });
        this.renderChildren(box, childNodes(n), depth + 1, 0);
        open = true;
      } else {
        open = box.hasClass("is-hidden");
        box.toggleClass("is-hidden", !open);
      }
      toggle.setText(open ? "▾" : "▸");
    });
  }

  /** Dibuja los hijos de uno en uno por páginas para no llenar el DOM con listas enormes. */
  private renderChildren(box: HTMLElement, all: ExplorerNode[], depth: number, from: number): void {
    const to = Math.min(from + EXPLORER_PAGE, all.length);
    for (let i = from; i < to; i++) this.renderNode(box, all[i], depth);
    if (to < all.length) {
      const more = box.createEl("button", { cls: "zl-btn zl-ex-more", text: `Mostrar más (${all.length - to} restantes)`, attr: { type: "button" } });
      more.addEventListener("click", () => {
        more.remove();
        this.renderChildren(box, all, depth, to);
      });
    }
  }
}

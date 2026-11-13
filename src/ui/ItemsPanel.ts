import { ANY_FIELD, FIELD_SUGGESTIONS } from "../filter/fields";
import type { Condition } from "../filter/query";
import { parseQuery } from "../filter/query";
import { primaryCreator } from "../filter/sortGroup";
import type { ItemGroupKey, ItemSortKey } from "../filter/sortGroup";
import { collator } from "../filter/text";
import type { LibraryIndex } from "../index/LibraryIndex";
import type { ZoteroCollection, ZoteroItem } from "../model/types";
import { BUILTIN_PREFIX, ROW_FORMATS } from "../template/rowFormats";
import { Floating, helpButton, helpRow } from "./floating";
import { SELECTED_SECTION, buildListRows, type ListRow } from "./listRows";
import { ITEM_GROUPS, ITEM_SORTS } from "./options";
import { OPERATORS, emptyCondition, fieldFromText, operatorById, operatorOf } from "./operators";
import { toggleInList, type Derived, type ViewState } from "./state";
import { VirtualList } from "./VirtualList";
import { actionButton, segmented, selectControl, type Segmented, type SelectControl } from "./widgets";

export interface PanelHost {
  state(): ViewState;
  patch(p: Partial<ViewState>): void;
  index(): LibraryIndex;
}

export interface ItemsHost extends PanelHost {
  /** Rutas de las plantillas de la carpeta configurada (para elegir el formato de fila) */
  templateNames(): string[];
  /** Texto de una fila de la lista según el formato de fila elegido */
  rowLabel(item: ZoteroItem): string;
  /** Clic derecho sobre un ítem de la lista (menú de abrir y encontrar) */
  onItemMenu(item: ZoteroItem, e: MouseEvent): void;
}

export function itemLabel(i: ZoteroItem): string {
  const c = primaryCreator(i);
  const who = c ? (c.lastName ?? c.name ?? "") : "s. a.";
  return `${who || "s. a."} (${i.year ?? "s. f."}) — ${i.title || "(sin título)"}`;
}

/** Nombres de campo reales de la biblioteca, con su capitalización original. */
export function realFieldNames(index: LibraryIndex): string[] {
  const names = new Set<string>();
  for (const i of index.items.values()) for (const k of Object.keys(i.fields)) names.add(k);
  return [...names].sort((a, b) => collator.compare(a, b));
}

/** Panel de ítems: colecciones, búsqueda (simple o compleja) y lista con selección. */
export class ItemsPanel {
  readonly el: HTMLElement;
  private readonly expanded = new Set<string>();
  private readonly countEl: HTMLElement;
  private readonly collSummary: HTMLElement;
  private readonly collFloat: Floating;
  private fieldFloat: Floating | null = null;
  private readonly collBody: HTMLElement;
  private readonly subToggle: HTMLInputElement;
  private readonly pickSeg: Segmented<"all" | "none">;
  private readonly searchSeg: Segmented<"simple" | "complex">;
  private readonly combineSeg: Segmented<"and" | "or">;
  private readonly simpleBox: HTMLElement;
  private readonly simpleInput: HTMLInputElement;
  private readonly complexBox: HTMLElement;
  private readonly rowsBox: HTMLElement;
  private readonly warnings: HTMLElement;
  private readonly list: VirtualList<ListRow>;
  private readonly listSort: SelectControl<ItemSortKey>;
  private readonly listGroup: SelectControl<ItemGroupKey>;
  private readonly listDir: HTMLElement;
  private readonly rowFormatSel: HTMLSelectElement;
  /** Secciones plegadas de la lista (el plegado no se recuerda entre sesiones; «Seleccionados» empieza plegado) */
  private readonly collapsed = new Set<string>([SELECTED_SECTION]);
  private lastDerived: Derived | null = null;
  private rowsSignature = "";
  private selected = new Set<string>();
  private lastAvailableKey = "";

  constructor(
    parent: HTMLElement,
    private readonly host: ItemsHost,
  ) {
    this.el = parent.createDiv({ cls: "zl-panel zl-items" });

    const head = this.el.createDiv({ cls: "zl-panel-head" });
    head.createEl("h3", { text: "Ítems" });
    this.countEl = head.createSpan({ cls: "zl-count" });
    // --- Colecciones: desplegable flotante por encima del panel; sigue abierto para elegir varias ---
    const collBtn = this.el.createEl("button", { cls: "zl-coll-btn", attr: { type: "button", title: "Limitar la lista a una o varias colecciones" } });
    this.collSummary = collBtn.createSpan({ cls: "zl-coll-label", text: "Colecciones" });
    collBtn.createSpan({ cls: "zl-coll-chevron", text: "▾" });
    const collMenu = this.el.ownerDocument.createElement("div");
    collMenu.className = "zl-coll-menu";
    const subRow = collMenu.createDiv({ cls: "zl-row-inline" });
    const subLabel = subRow.createEl("label");
    this.subToggle = subLabel.createEl("input", { type: "checkbox" });
    subLabel.createSpan({ text: " Incluir subcolecciones" });
    this.subToggle.addEventListener("change", () => this.host.patch({ includeSubcollections: this.subToggle.checked }));
    actionButton(subRow, "Limpiar", () => this.host.patch({ collections: [] }));
    this.collBody = collMenu.createDiv({ cls: "zl-tree" });
    this.collFloat = new Floating(collBtn, collMenu, { cls: "zl-float-collections", maxHeight: 420, minWidth: 320 });
    collBtn.addEventListener("click", () => this.collFloat.toggle());

    // --- Búsqueda ---
    const search = this.el.createDiv({ cls: "zl-search" });
    const modes = search.createDiv({ cls: "zl-search-modes" });
    this.searchSeg = segmented(modes, [
      { value: "simple", label: "Simple" },
      { value: "complex", label: "Compleja" },
    ], (v) => this.switchSearchMode(v));
    const modesRight = modes.createDiv({ cls: "zl-actions" });
    this.combineSeg = segmented(modesRight, [
      { value: "and", label: "Y", title: "Se deben cumplir todas las condiciones" },
      { value: "or", label: "O", title: "Basta con que se cumpla una" },
    ], (v) => this.host.patch({ combine: v }));
    this.pickSeg = segmented(modesRight, [
      { value: "all", label: "Todos" },
      { value: "none", label: "Ninguno" },
    ], (v) => this.host.patch({ selectedItems: v === "all" ? [...new Set([...this.host.state().selectedItems, ...this.currentAvailable.map((i) => i.key)])] : [] }));

    this.simpleBox = search.createDiv({ cls: "zl-simple" });
    const field = this.simpleBox.createDiv({ cls: "zl-field" });
    this.simpleInput = field.createEl("input", { type: "search", cls: "zl-input", placeholder: "Buscar…" });
    this.simpleInput.addEventListener("input", () => this.host.patch({ searchText: this.simpleInput.value }));
    helpButton(field, (box) => {
      box.createDiv({ cls: "zl-help-title", text: "Sintaxis de la búsqueda" });
      helpRow(box, "@campo: valor", "busca solo en ese campo (@autor, @año, @título…)");
      helpRow(box, "-término", "excluye lo que coincida");
      helpRow(box, "@año: 1850-1900", "rango de años; también >1990 o <1900");
      helpRow(box, "XIX", "un siglo en números romanos (1801–1900)");
      helpRow(box, "|", "separa términos; se combinan con Y / O");
      helpRow(box, "@autor: Marx | ideología", "ejemplo con dos términos");
    }, "Ayuda de la búsqueda");

    this.complexBox = search.createDiv({ cls: "zl-complex" });
    this.rowsBox = this.complexBox.createDiv({ cls: "zl-rows" });
    actionButton(this.complexBox, "+ Añadir condición", () => this.host.patch({ complexConditions: [...this.host.state().complexConditions, emptyCondition()] }));

    this.warnings = search.createDiv({ cls: "zl-warnings" });

    // --- Opciones de la lista: orden, agrupación y formato de fila (independientes de los de resultados) ---
    const opts = this.el.createDiv({ cls: "zl-toolbar zl-list-opts" });
    this.listSort = selectControl(opts, ITEM_SORTS, (v) => this.host.patch({ listSort: { ...this.host.state().listSort, key: v } }));
    this.listDir = actionButton(opts, "↑", () => {
      const cur = this.host.state().listSort;
      this.host.patch({ listSort: { ...cur, dir: cur.dir === "asc" ? "desc" : "asc" } });
    }, "Invertir el orden de la lista");
    this.listGroup = selectControl(opts, ITEM_GROUPS, (v) => this.host.patch({ listGroup: v }));
    this.rowFormatSel = opts.createEl("select", { cls: "dropdown zl-select zl-row-format", attr: { title: "Formato de cada fila de la lista (plantilla Nunjucks de una línea)" } });
    this.rowFormatSel.addEventListener("change", () => this.host.patch({ rowFormat: this.rowFormatSel.value }));

    // --- Lista ---
    this.list = new VirtualList<ListRow>(this.el, {
      rowHeight: 30,
      renderRow: (row, r) => (r.type === "header" ? this.renderHeaderRow(row, r) : this.renderItemRow(row, r.item, r.section, !!r.hidden, !!r.last)),
    });
  }

  /** Vuelve a dibujar las filas visibles (p. ej. cuando cambia la plantilla del formato de fila). */
  redrawRows(): void {
    this.list.refresh();
  }

  /** Redibuja la ventana visible al mostrar el panel después de estar oculto. */
  refreshViewport(): void {
    this.list.refresh();
  }

  private currentAvailable: ZoteroItem[] = [];

  update(d: Derived): void {
    const s = this.host.state();
    this.currentAvailable = d.available;
    this.selected = new Set(d.selectedItems);
    const outside = d.selectedHidden.length;
    const shown = d.selectedItems.length - outside;
    this.countEl.setText(`${shown} ${shown === 1 ? "seleccionado" : "seleccionados"} de ${d.available.length}${outside ? ` · ${outside} fuera de la búsqueda` : ""}`);
    this.pickSeg.set(d.selectedItems.length === 0 ? "none" : d.available.length > 0 && shown === d.available.length ? "all" : null);

    this.collSummary.setText(s.collections.length ? `Colecciones (${s.collections.length} elegidas)` : "Colecciones (toda la biblioteca)");
    this.subToggle.checked = s.includeSubcollections;
    this.renderTree(new Set(s.collections));

    this.searchSeg.set(s.searchMode);
    this.combineSeg.set(s.combine);
    this.simpleBox.toggleClass("is-hidden", s.searchMode !== "simple");
    this.complexBox.toggleClass("is-hidden", s.searchMode !== "complex");
    if (this.simpleInput.value !== s.searchText && this.simpleInput.ownerDocument.activeElement !== this.simpleInput) this.simpleInput.value = s.searchText;
    this.syncRows(s.complexConditions);

    this.warnings.empty();
    for (const w of d.warnings) this.warnings.createDiv({ cls: "zl-warning", text: `⚠️ ${w}` });

    this.lastDerived = d;
    this.listSort.set(s.listSort.key);
    this.listDir.setText(s.listSort.dir === "asc" ? "↑" : "↓");
    this.listGroup.set(s.listGroup);
    this.syncRowFormats(s.rowFormat);

    // Si cambia el conjunto disponible, su orden o su agrupación, la lista vuelve arriba; si solo cambia la selección, no.
    const key = `${d.available.map((i) => i.key).join(",")}|${s.listSort.key}${s.listSort.dir}|${s.listGroup}`;
    this.list.setItems(buildListRows(d, this.collapsed), key !== this.lastAvailableKey);
    this.lastAvailableKey = key;
  }

  /** Opciones del selector de formato de fila: incluidos + plantillas de la carpeta. */
  private syncRowFormats(chosen: string): void {
    const names = this.host.templateNames();
    const signature = `${names.join("|")}#${chosen}`;
    if (signature !== this.rowFormatSignature) {
      this.rowFormatSignature = signature;
      this.rowFormatSel.empty();
      this.rowFormatSel.createEl("option", { text: "Por defecto", value: "", attr: { title: "El formato elegido en los ajustes; si no hay ninguno, Autor (Año) — Título" } });
      for (const f of ROW_FORMATS) this.rowFormatSel.createEl("option", { text: f.label, value: BUILTIN_PREFIX + f.id });
      for (const n of names) this.rowFormatSel.createEl("option", { text: `Plantilla: ${n}`, value: n });
      const known = chosen === "" || chosen.startsWith(BUILTIN_PREFIX) || names.includes(chosen);
      if (!known) this.rowFormatSel.createEl("option", { text: `${chosen} (no encontrada)`, value: chosen });
    }
    if (this.rowFormatSel.value !== chosen) this.rowFormatSel.value = chosen;
  }
  private rowFormatSignature = "";

  private renderHeaderRow(row: HTMLElement, r: Extract<ListRow, { type: "header" }>): void {
    row.addClass("zl-group-row");
    row.addClass(`is-${r.kind}`);
    row.createSpan({ cls: "zl-chevron", text: r.collapsed ? "▸" : "▾" });

    // Casilla de tres estados: todos / algunos / ninguno de los ítems de la sección.
    // «Seleccionados» siempre está marcada (todo lo que contiene está seleccionado) y al pulsarla quita toda la selección.
    const chosen = this.selected;
    const inSection = r.keys.filter((k) => chosen.has(k)).length;
    const all = r.keys.length > 0 && inSection === r.keys.length;
    const box = row.createEl("input", { type: "checkbox", cls: "zl-group-check" });
    box.checked = all;
    box.indeterminate = inSection > 0 && !all;
    box.addEventListener("click", (e) => {
      e.stopPropagation(); // el clic en el nombre pliega; el de la casilla solo selecciona
      const cur = this.host.state().selectedItems;
      if (r.kind === "selected") {
        this.host.patch({ selectedItems: [] });
      } else if (all) {
        const drop = new Set(r.keys);
        this.host.patch({ selectedItems: cur.filter((k) => !drop.has(k)) });
      } else {
        this.host.patch({ selectedItems: [...new Set([...cur, ...r.keys])] });
      }
    });

    row.createSpan({ cls: "zl-group-label", text: r.label, attr: { title: r.label } });
    row.createSpan({ cls: "zl-tag-count", text: String(r.count) });
    row.addEventListener("click", () => {
      if (this.collapsed.has(r.id)) this.collapsed.delete(r.id);
      else this.collapsed.add(r.id);
      if (this.lastDerived) this.list.setItems(buildListRows(this.lastDerived, this.collapsed), false);
    });
  }

  private renderItemRow(row: HTMLElement, item: ZoteroItem, section: string, hidden = false, last = false): void {
    row.addClass("zl-item-row");
    if (section === SELECTED_SECTION) row.addClass("in-selected-section");
    if (last) row.addClass("is-section-last");
    const checked = this.selected.has(item.key);
    row.toggleClass("is-selected", checked);
    const box = row.createEl("input", { type: "checkbox" });
    box.checked = checked;
    // Adjuntos sin contenedor: solo el nombre del archivo y una etiqueta (no tienen metadata)
    const label = item.fromAttachment ? item.title : this.host.rowLabel(item);
    row.createSpan({ cls: "zl-item-label", text: label, attr: { title: label } });
    // Total de anotaciones del ítem (todos sus adjuntos, sin depender de los filtros); se oculta si es 0.
    // Va como elemento propio de la fila, junto al borde derecho: solo el nombre se recorta, el contador siempre se ve.
    const annotations = this.annotationTotal(item);
    if (annotations > 0) row.createSpan({ cls: "zl-ann-count", text: String(annotations), attr: { title: `${annotations} ${annotations === 1 ? "anotación" : "anotaciones"}` } });
    if (hidden) row.createSpan({ cls: "zl-row-tag", text: "fuera de la búsqueda", attr: { title: "Sigue seleccionado, pero la búsqueda o las colecciones elegidas no lo muestran en la lista" } });
    if (item.fromAttachment) row.createSpan({ cls: "zl-row-tag", text: "adjunto", attr: { title: "Adjunto sin contenedor: no tiene ítem en Zotero" } });
    row.addEventListener("click", (e) => {
      e.preventDefault();
      this.host.patch({ selectedItems: toggleInList(this.host.state().selectedItems, item.key) });
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.host.onItemMenu(item, e);
    });
  }

  private annotationTotal(item: ZoteroItem): number {
    let n = 0;
    for (const a of this.host.index().attachmentsOf(item.key)) n += a.annotationKeys.length;
    return n;
  }

  // ----- Colecciones -----
  private renderTree(selected: Set<string>): void {
    const index = this.host.index();
    const direct = new Map<string, number>();
    for (const i of index.items.values()) for (const c of i.collections) direct.set(c, (direct.get(c) ?? 0) + 1);
    const children = new Map<string, ZoteroCollection[]>();
    const roots: ZoteroCollection[] = [];
    for (const c of index.collections.values()) {
      if (c.parentKey && index.collections.has(c.parentKey)) children.set(c.parentKey, [...(children.get(c.parentKey) ?? []), c]);
      else roots.push(c);
    }
    const byName = (a: ZoteroCollection, b: ZoteroCollection) => collator.compare(a.name, b.name);
    this.collBody.empty();
    const draw = (c: ZoteroCollection, depth: number) => {
      const kids = (children.get(c.key) ?? []).sort(byName);
      const row = this.collBody.createDiv({ cls: "zl-tree-row" });
      row.style.paddingLeft = `${depth * 16}px`;
      const chevron = row.createSpan({ cls: "zl-chevron", text: kids.length ? (this.expanded.has(c.key) ? "▾" : "▸") : "" });
      if (kids.length) {
        chevron.addEventListener("click", () => {
          if (this.expanded.has(c.key)) this.expanded.delete(c.key);
          else this.expanded.add(c.key);
          this.renderTree(new Set(this.host.state().collections));
        });
      }
      const label = row.createEl("label");
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = selected.has(c.key);
      box.addEventListener("change", () => this.host.patch({ collections: toggleInList(this.host.state().collections, c.key) }));
      label.createSpan({ text: ` ${c.name} (${direct.get(c.key) ?? 0})` });
      if (kids.length && this.expanded.has(c.key)) for (const k of kids) draw(k, depth + 1);
    };
    for (const r of roots.sort(byName)) draw(r, 0);
    this.collFloat.place();
  }

  private fieldNames: string[] | null = null;

  /** Lista flotante de campos bajo el cuadro de texto, filtrada por lo escrito; elegir uno lo pone en el cuadro. */
  private suggestFields(input: HTMLInputElement): void {
    this.fieldFloat?.destroy();
    this.fieldFloat = null;
    this.fieldNames ??= [...new Set([...FIELD_SUGGESTIONS, ...realFieldNames(this.host.index())])];
    const typed = input.value.trim().toLowerCase();
    const matches = this.fieldNames.filter((f) => f.toLowerCase().includes(typed) && f.toLowerCase() !== typed).slice(0, 60);
    if (matches.length === 0) return;
    const box = input.ownerDocument.createElement("div");
    box.className = "zl-suggest";
    for (const f of matches) {
      const opt = box.createDiv({ cls: "zl-suggest-item", text: f });
      // mousedown (no click) y sin quitar el foco al cuadro de texto
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = f;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        this.fieldFloat?.destroy();
        this.fieldFloat = null;
      });
    }
    const fl = new Floating(input, box, { cls: "zl-float-suggest", maxHeight: 240 });
    this.fieldFloat = fl;
    input.addEventListener("blur", () => { if (this.fieldFloat === fl) { fl.destroy(); this.fieldFloat = null; } }, { once: true });
    fl.open();
  }

  // ----- Búsqueda compleja -----
  private switchSearchMode(mode: "simple" | "complex"): void {
    const s = this.host.state();
    if (mode === "complex" && s.complexConditions.length === 0) {
      const parsed = parseQuery(s.searchText, s.combine).spec.conditions;
      this.host.patch({ searchMode: mode, complexConditions: parsed.length ? parsed : [emptyCondition()] });
    } else {
      this.host.patch({ searchMode: mode });
    }
  }

  /** Reconstruye las filas solo si cambia su número, para no perder el foco al escribir. */
  private syncRows(conditions: Condition[]): void {
    const signature = String(conditions.length);
    if (signature === this.rowsSignature && this.rowsBox.childElementCount === conditions.length) return;
    this.rowsSignature = signature;
    this.rowsBox.empty();
    conditions.forEach((c, i) => this.renderConditionRow(c, i));
  }

  private renderConditionRow(c: Condition, i: number): void {
    const row = this.rowsBox.createDiv({ cls: "zl-cond" });
    const edit = (change: (cur: Condition) => Condition) => {
      const list = [...this.host.state().complexConditions];
      list[i] = change(list[i] ?? emptyCondition());
      this.host.patch({ complexConditions: list });
    };

    const field = row.createEl("input", { type: "text", cls: "zl-input zl-cond-field", placeholder: "(cualquier campo)" });
    field.value = c.field === ANY_FIELD ? "" : c.field;
    field.addEventListener("input", () => {
      edit((cur) => ({ ...cur, field: fieldFromText(field.value) }));
      this.suggestFields(field);
    });
    field.addEventListener("focus", () => this.suggestFields(field));

    const op = row.createEl("select", { cls: "dropdown zl-cond-op" });
    for (const o of OPERATORS) op.createEl("option", { text: o.label, value: o.id });
    op.value = operatorOf(c).id;

    const v1 = row.createEl("input", { type: "text", cls: "zl-input zl-cond-value" });
    v1.value = c.value;
    const v2 = row.createEl("input", { type: "text", cls: "zl-input zl-cond-value" });
    v2.value = c.value2 ?? "";
    const showValues = () => {
      const needs = operatorById(op.value).needs;
      v1.toggleClass("is-hidden", needs === 0);
      v2.toggleClass("is-hidden", needs !== 2);
    };
    showValues();
    op.addEventListener("change", () => {
      const def = operatorById(op.value);
      showValues();
      edit((cur) => ({ ...cur, op: def.op, negate: def.negate }));
    });
    v1.addEventListener("input", () => edit((cur) => ({ ...cur, value: v1.value })));
    v2.addEventListener("input", () => edit((cur) => ({ ...cur, value2: v2.value })));

    actionButton(row, "✕", () => {
      const list = this.host.state().complexConditions.filter((_, k) => k !== i);
      this.host.patch({ complexConditions: list });
    }, "Quitar condición");
  }
}

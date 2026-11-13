import { toggleInList, visibleTags, type Derived, type TagRow } from "./state";
import type { PanelHost } from "./ItemsPanel";
import { VirtualList } from "./VirtualList";
import { actionButton, segmented, type Segmented } from "./widgets";

/** Panel de etiquetas de anotaciones: solo las de los ítems seleccionados. */
export class TagsPanel {
  readonly el: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly matchSeg: Segmented<"all" | "any">;
  private readonly searchInput: HTMLInputElement;
  private readonly chosen: HTMLElement;
  private readonly chosenHead: HTMLElement;
  private readonly chips: HTMLElement;
  /** Plegado del contenedor de etiquetas elegidas (empieza desplegado; no se recuerda entre sesiones) */
  private folded = false;
  private readonly empty: HTMLElement;
  private readonly list: VirtualList<TagRow>;
  private lastSignature = "";

  constructor(
    parent: HTMLElement,
    private readonly host: PanelHost,
  ) {
    this.el = parent.createDiv({ cls: "zl-panel zl-tags" });
    const head = this.el.createDiv({ cls: "zl-panel-head" });
    head.createEl("h3", { text: "Etiquetas" });
    this.countEl = head.createSpan({ cls: "zl-count" });
    const actions = head.createDiv({ cls: "zl-actions" });
    this.matchSeg = segmented(actions, [
      { value: "all", label: "Y", title: "La anotación debe tener todas las etiquetas elegidas" },
      { value: "any", label: "O", title: "Basta con que tenga una" },
    ], (v) => this.host.patch({ tagMatch: v }));
    actionButton(actions, "Limpiar", () => this.host.patch({ selectedTags: [] }));

    this.searchInput = this.el.createEl("input", { type: "search", cls: "zl-input", placeholder: "Buscar etiqueta…" });
    this.searchInput.addEventListener("input", () => this.host.patch({ tagSearch: this.searchInput.value }));
    this.chosen = this.el.createDiv({ cls: "zl-chosen" });
    this.chosenHead = this.chosen.createDiv({ cls: "zl-chosen-head" });
    this.chosenHead.addEventListener("click", () => {
      this.folded = !this.folded;
      this.syncChosen(this.host.state().selectedTags);
    });
    this.chips = this.chosen.createDiv({ cls: "zl-chips" });
    this.empty = this.el.createDiv({ cls: "zl-empty" });
    this.list = new VirtualList<TagRow>(this.el, { rowHeight: 28, renderRow: (row, t) => this.renderRow(row, t) });
  }

  update(d: Derived): void {
    const s = this.host.state();
    this.matchSeg.set(s.tagMatch);
    if (this.searchInput.value !== s.tagSearch && this.searchInput.ownerDocument.activeElement !== this.searchInput) this.searchInput.value = s.tagSearch;

    const noItems = d.selectedItems.length === 0;
    this.empty.toggleClass("is-hidden", !noItems);
    this.empty.setText(noItems ? "Selecciona ítems para ver las etiquetas de sus anotaciones." : "");
    this.list.el.toggleClass("is-hidden", noItems);

    const rows = noItems ? [] : visibleTags(d.tags, d.selectedTags, s.tagSearch);
    this.countEl.setText(noItems ? "" : `${rows.length} de ${d.tags.tags.length}`);

    this.chips.empty();
    for (const t of d.selectedTags) {
      const chip = this.chips.createSpan({ cls: "zl-chip", text: `${t} ✕` });
      chip.addEventListener("click", () => this.host.patch({ selectedTags: toggleInList(this.host.state().selectedTags, t) }));
    }
    this.syncChosen([...d.selectedTags]);

    // Vuelve arriba solo si cambia la lista (no al marcar una etiqueta).
    const signature = `${s.tagSearch}|${d.selectedItems.join(",")}`;
    this.list.setItems(rows, signature !== this.lastSignature);
    this.lastSignature = signature;
  }

  /** Redibuja la ventana visible al mostrar el panel después de estar oculto. */
  refreshViewport(): void {
    this.list.refresh();
  }

  /** Cabecera plegable de las etiquetas elegidas: oculta si no hay ninguna. */
  private syncChosen(tags: string[]): void {
    this.chosen.toggleClass("is-hidden", tags.length === 0);
    this.chosen.toggleClass("is-folded", this.folded);
    this.chosenHead.setText(`${this.folded ? "▸" : "▾"} Etiquetas elegidas (${tags.length})`);
    this.chips.toggleClass("is-hidden", this.folded);
  }

  private renderRow(row: HTMLElement, t: TagRow): void {
    row.addClass("zl-tag-row");
    row.toggleClass("is-selected", t.selected);
    const box = row.createEl("input", { type: "checkbox" });
    box.checked = t.selected;
    row.createSpan({ cls: "zl-tag-name", text: t.tag, attr: { title: t.tag } });
    row.createSpan({ cls: "zl-tag-count", text: String(t.count), attr: { title: tagCountTitle(this.host.state().tagMatch, this.host.state().selectedTags.length) } });
    row.addEventListener("click", (e) => {
      e.preventDefault();
      this.host.patch({ selectedTags: toggleInList(this.host.state().selectedTags, t.tag) });
    });
  }
}

/** Qué significa el número junto a una etiqueta según el estado de la selección. */
export function tagCountTitle(match: "all" | "any", chosen: number): string {
  if (chosen === 0) return "Anotaciones con esta etiqueta";
  return match === "all" ? "Anotaciones que quedarían si la eliges ahora (de las del resultado actual)" : "Anotaciones que tendrías si la eliges ahora (las actuales más las que añade)";
}

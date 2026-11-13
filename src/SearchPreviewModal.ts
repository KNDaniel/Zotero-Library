import { App, Modal, Setting } from "obsidian";
import { availableItems, tagPanel } from "./filter/selection";
import { knownFieldNames } from "./filter/fields";
import { parseQuery } from "./filter/query";
import { primaryCreator, sortItems } from "./filter/sortGroup";
import type { LibraryIndex } from "./index/LibraryIndex";

/**
 * Vista previa mínima de la Fase 2: sirve para probar la búsqueda rápida y el
 * panel de etiquetas contra tu biblioteca real. Los paneles definitivos llegan
 * en la Fase 4.
 */
export class SearchPreviewModal extends Modal {
  private text = "";
  private mode: "and" | "or" = "and";
  private includeSub = true;
  private timer: number | undefined;
  private out!: HTMLElement;

  constructor(
    app: App,
    private readonly index: LibraryIndex,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("Buscar ítems (prueba de la Fase 2)");
    contentEl.createEl("p", {
      text: "Ejemplos: @autor: Marx | ideología | @año: XIX   ·   -@autor: Engels   ·   @colección: Hegel   ·   @año: 1850-1900",
      cls: "setting-item-description",
    });

    new Setting(contentEl).setName("Búsqueda").addText((t) => {
      t.inputEl.style.width = "100%";
      t.setPlaceholder("@autor: Marx | ideología | @año: XIX").onChange((v) => {
        this.text = v;
        this.schedule();
      });
      t.inputEl.focus();
    });
    new Setting(contentEl)
      .setName("Combinar términos con")
      .addDropdown((d) =>
        d
          .addOption("and", "Y (todos)")
          .addOption("or", "O (alguno)")
          .setValue(this.mode)
          .onChange((v) => {
            this.mode = v as "and" | "or";
            this.render();
          }),
      );
    new Setting(contentEl).setName("Incluir subcolecciones en @colección").addToggle((t) =>
      t.setValue(this.includeSub).onChange((v) => {
        this.includeSub = v;
        this.render();
      }),
    );

    this.out = contentEl.createDiv();
    this.render();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 150);
  }

  private render(): void {
    const out = this.out;
    out.empty();
    const { spec, warnings } = parseQuery(this.text, this.mode, knownFieldNames(this.index));
    for (const w of warnings) out.createEl("p", { text: `⚠️ ${w}` });

    const items = sortItems(availableItems(this.index, { collections: [], includeSubcollections: this.includeSub, query: spec }), "author");
    out.createEl("p", { text: `${items.length} de ${this.index.items.size} ítems` });

    const list = out.createEl("ul");
    for (const i of items.slice(0, 25)) {
      const c = primaryCreator(i);
      const who = c ? (c.lastName ?? c.name ?? "") : "s. a.";
      list.createEl("li", { text: `${who} (${i.year ?? "s. f."}) — ${i.title}` });
    }
    if (items.length > 25) out.createEl("p", { text: `… y ${items.length - 25} más`, cls: "setting-item-description" });

    // Panel de etiquetas como si todos los ítems encontrados estuvieran seleccionados.
    const panel = tagPanel(this.index, items.map((i) => i.key), []);
    const annotations = items.reduce((n, i) => n + this.index.annotationsOf(i.key).length, 0);
    out.createEl("p", { text: `Anotaciones de estos ítems: ${annotations}; etiquetas de anotaciones distintas: ${panel.tags.length}.` });
    const top = [...panel.tags].sort((a, b) => b.count - a.count).slice(0, 10);
    if (top.length) out.createEl("p", { text: `Etiquetas más usadas: ${top.map((t) => `${t.tag} (${t.count})`).join(" · ")}`, cls: "setting-item-description" });
  }

  onClose(): void {
    window.clearTimeout(this.timer);
    this.contentEl.empty();
  }
}

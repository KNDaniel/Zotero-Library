import { App, Modal, Notice, Setting } from "obsidian";
import { annotationKeysIn, compareText, formatComparison } from "./template/compare";

export interface CompareState {
  template: string;
  itemKey: string;
  notePath: string;
}

/** Lo que el modal necesita del plugin (evita una dependencia circular). */
export interface CompareHost {
  templates(): string[];
  /** Nota activa en este momento (o la última abierta) */
  activeNotePath(): string | null;
  /** Última comparación, para recordar plantilla, ítem y nota */
  loadState(): CompareState;
  saveState(state: CompareState): Promise<void>;
  /** Renderiza una plantilla de ámbito ítem con todas las anotaciones del ítem */
  renderItemTemplate(templatePath: string, itemKey: string): Promise<string>;
  /** Lee una nota del vault; acepta la ruta con o sin «.md» */
  readNote(path: string): Promise<string | null>;
  /** Datos de orden de las anotaciones implicadas en las diferencias */
  describeAnnotations(keys: string[]): string[];
}

/**
 * Renderiza una plantilla para un ítem y la compara con una nota que ya
 * generaste con Zotero Integration: es la prueba de compatibilidad con tus datos reales.
 */
export class CompareModal extends Modal {
  private state: CompareState;
  private out!: HTMLElement;
  private lastText = "";
  private noteInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly host: CompareHost,
  ) {
    super(app);
    this.state = host.loadState();
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("Comparar plantilla con una nota existente");
    contentEl.createEl("p", {
      text: "Renderiza la plantilla para un ítem de Zotero y la compara línea a línea con una nota que ya generaste. Recuerda tu última elección.",
      cls: "setting-item-description",
    });

    const templates = this.host.templates();
    if (!templates.includes(this.state.template)) this.state.template = templates[0] ?? "";
    new Setting(contentEl).setName("Plantilla").addDropdown((d) => {
      if (!templates.length) d.addOption("", "(no hay plantillas en la carpeta configurada)");
      for (const t of templates) d.addOption(t, t);
      d.setValue(this.state.template).onChange(async (v) => {
        this.state.template = v;
        await this.host.saveState(this.state);
      });
    });

    new Setting(contentEl)
      .setName("Clave del ítem de Zotero")
      .setDesc("Las 8 letras/números del ítem (no del adjunto), p. ej. ITEM0001.")
      .addText((t) =>
        t.setPlaceholder("ITEM0001").setValue(this.state.itemKey).onChange(async (v) => {
          this.state.itemKey = v.trim().toUpperCase();
          await this.host.saveState(this.state);
        }),
      );

    // La nota activa tiene prioridad; si no hay ninguna, la última que se usó.
    const active = this.host.activeNotePath();
    if (active) this.state.notePath = active;
    new Setting(contentEl)
      .setName("Nota a comparar")
      .setDesc("Por defecto, la nota activa. Si lo dejas vacío al comparar, se usa la nota activa en ese momento.")
      .addText((t) => {
        t.inputEl.style.width = "100%";
        this.noteInput = t.inputEl;
        t.setValue(this.state.notePath).onChange((v) => (this.state.notePath = v.trim()));
      })
      .addButton((b) =>
        b.setButtonText("Usar la nota activa").onClick(() => {
          const path = this.host.activeNotePath();
          if (!path) return void new Notice("No hay ninguna nota activa.");
          this.state.notePath = path;
          if (this.noteInput) this.noteInput.value = path;
        }),
      );

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Comparar").setCta().onClick(() => void this.run()))
      .addButton((b) =>
        b.setButtonText("Copiar resultado").onClick(async () => {
          await navigator.clipboard.writeText(this.lastText);
          new Notice("Copiado al portapapeles");
        }),
      );
    this.out = contentEl.createEl("pre");
    this.out.style.whiteSpace = "pre-wrap";
    this.out.style.userSelect = "text";
  }

  private async run(): Promise<void> {
    this.out.setText("Renderizando…");
    try {
      const { template, itemKey } = this.state;
      const notePath = this.state.notePath || this.host.activeNotePath() || "";
      if (!template) throw new Error("Elige una plantilla.");
      if (!/^[A-Z0-9]{8}$/.test(itemKey)) throw new Error("La clave del ítem debe tener 8 letras o números.");
      if (!notePath) throw new Error("Indica la nota a comparar o abre una nota para usarla como referencia.");
      this.state.notePath = notePath;
      if (this.noteInput) this.noteInput.value = notePath;
      await this.host.saveState(this.state);

      const expected = await this.host.readNote(notePath);
      if (expected === null) throw new Error(`No encuentro la nota «${notePath}».`);
      const actual = await this.host.renderItemTemplate(template, itemKey);
      const comparison = compareText(actual, expected);
      const lines = [formatComparison(comparison)];
      if (!comparison.identical) {
        const info = this.host.describeAnnotations(annotationKeysIn(comparison));
        if (info.length) lines.push("Datos de orden de las anotaciones implicadas:", ...info.map((i) => `  ${i}`));
      }
      this.lastText = lines.join("\n");
    } catch (e) {
      this.lastText = `Error: ${(e as Error).message}`;
    }
    this.out.setText(this.lastText);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

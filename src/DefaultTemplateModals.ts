import { App, FuzzySuggestModal, Modal, Setting } from "obsidian";
import { defaultTemplateEntries, type DefaultTemplateEntry } from "./template/defaultNotes";

/** Elegir cuál de las plantillas por defecto se vuelca a una nota. */
export class DefaultTemplatePicker extends FuzzySuggestModal<DefaultTemplateEntry> {
  constructor(
    app: App,
    private readonly onPick: (entry: DefaultTemplateEntry) => void,
  ) {
    super(app);
    this.setPlaceholder("Elige la plantilla por defecto que quieres editar…");
  }

  getItems(): DefaultTemplateEntry[] {
    return defaultTemplateEntries();
  }

  getItemText(e: DefaultTemplateEntry): string {
    return `${e.group}: ${e.label}`;
  }

  onChooseItem(e: DefaultTemplateEntry): void {
    this.onPick(e);
  }
}

/** Pregunta sí/no antes de reemplazar una nota que ya existe. */
export class ConfirmReplaceModal extends Modal {
  constructor(
    app: App,
    private readonly path: string,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("La nota ya existe");
    this.contentEl.createEl("p", { text: `Ya hay una nota «${this.path}». ¿Quieres reemplazar su contenido por la plantilla por defecto? Se perderán los cambios que le hayas hecho.` });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Reemplazar").setDestructive().onClick(() => {
        this.close();
        this.onConfirm();
      }))
      .addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

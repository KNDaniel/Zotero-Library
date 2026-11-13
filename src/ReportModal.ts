import { App, Modal, Notice, Setting } from "obsidian";
import { writeClipboardText } from "./clipboard";

export class ReportModal extends Modal {
  constructor(
    app: App,
    private readonly markdown: string,
    private readonly saveAsNote: (() => Promise<void>) | null = null,
    private readonly title = "Informe de verificación",
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle(this.title);
    contentEl.createEl("p", {
      text: "Copia el texto y pégalo en el chat para ajustar el plugin a tus datos reales.",
    });
    const buttons = new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Copiar")
        .setCta()
        .onClick(async () => {
          await writeClipboardText(this.markdown);
          new Notice("Copiado al portapapeles");
        }),
    );
    const save = this.saveAsNote;
    if (save) {
      buttons.addButton((b) =>
        b.setButtonText("Guardar como nota").onClick(async () => {
          await save();
          this.close();
        }),
      );
    }
    const area = contentEl.createEl("textarea", { text: this.markdown });
    area.readOnly = true;
    area.rows = 18;
    area.style.width = "100%";
    area.style.fontFamily = "var(--font-monospace)";
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

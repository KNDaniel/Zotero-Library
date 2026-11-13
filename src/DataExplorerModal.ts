import { App, FuzzySuggestModal, Modal } from "obsidian";
import { DataExplorer, type CopyKind, type ExplorerSource, type ExplorerStart } from "./ui/explorer";

/** Ventana del explorador de datos: las variables de un ítem o una anotación para usar en plantillas. */
export class DataExplorerModal extends Modal {
  private explorer: DataExplorer | null = null;

  constructor(
    app: App,
    private readonly source: ExplorerSource,
    private readonly onCopy: (text: string, what: CopyKind) => void,
    private readonly start: ExplorerStart,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("zl-explorer-modal");
    this.titleEl.setText("Explorador de datos");
    this.explorer = new DataExplorer(this.contentEl, this.source, this.onCopy, this.start);
    this.explorer.focus();
  }

  onClose(): void {
    this.explorer?.destroy();
    this.contentEl.empty();
    this.explorer = null;
  }
}

export interface PickableItem {
  key: string;
  label: string;
}

/** Elegir el ítem cuyo contexto se quiere explorar (comando). */
export class ItemPickerModal extends FuzzySuggestModal<PickableItem> {
  constructor(
    app: App,
    private readonly choices: PickableItem[],
    private readonly onPick: (key: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Elige un ítem para explorar sus datos…");
  }

  getItems(): PickableItem[] {
    return this.choices;
  }

  getItemText(item: PickableItem): string {
    return item.label;
  }

  onChooseItem(item: PickableItem): void {
    this.onPick(item.key);
  }
}

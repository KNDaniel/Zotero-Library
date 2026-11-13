/**
 * Desplegable flotante común (colecciones, ayuda «?», lista de campos): se cuelga del <body> para no
 * quedar recortado por los paneles, se ancla a su disparador con altura máxima y scroll propio, y se
 * cierra con un clic fuera. Solo DOM: no depende de Obsidian.
 */
export interface FloatingOptions {
  /** Clase extra del contenedor flotante */
  cls?: string;
  /** Altura máxima en píxeles (además de no salirse de la ventana) */
  maxHeight?: number;
  /** Ancho mínimo; por defecto el del disparador */
  minWidth?: number;
  /** Se llama al cerrar (por clic fuera o por `close()`) */
  onClose?: () => void;
}

export class Floating {
  private static readonly all = new Set<Floating>();

  /**
   * Retira los desplegables cuyo disparador ya no está en el documento (o está dentro de `root`).
   * Se llama al rehacer los paneles y al cerrar la vista, para no dejar restos en el <body>.
   */
  static sweep(root?: HTMLElement): void {
    for (const f of [...Floating.all]) if (!f.trigger.isConnected || (root && root.contains(f.trigger))) f.destroy();
  }

  readonly el: HTMLElement;
  private opened = false;
  private readonly doc: Document;
  private readonly win: Window;
  private readonly onDown = (e: Event): void => {
    const t = e.target as Node | null;
    if (!t) return;
    if (this.el.contains(t) || this.trigger.contains(t)) return;
    this.close();
  };
  private readonly onScroll = (e: Event): void => {
    const t = e.target;
    if (t instanceof Node && this.el.contains(t)) return; // el scroll de su propio contenido no cuenta
    // Solo importa si se mueve el disparador (el panel o la página que lo contienen): entonces se recoloca.
    // El scroll de otras cosas (p. ej. la lista al elegir una colección) no debe cerrar un menú pensado para elegir varias.
    if (t === this.doc || (t instanceof Node && t.contains(this.trigger))) this.place();
  };
  private readonly onResize = (): void => this.close();

  constructor(
    private readonly trigger: HTMLElement,
    content: HTMLElement,
    private readonly opts: FloatingOptions = {},
  ) {
    this.doc = trigger.ownerDocument;
    this.win = this.doc.defaultView ?? window;
    this.el = this.doc.body.createDiv({ cls: `zl-float is-hidden ${opts.cls ?? ""}`.trim() });
    this.el.appendChild(content);
    Floating.all.add(this);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.el.classList.remove("is-hidden");
    this.place();
    // Fase de captura: se entera aunque el panel detenga la propagación del clic.
    this.doc.addEventListener("mousedown", this.onDown, true);
    this.doc.addEventListener("scroll", this.onScroll, true);
    this.win.addEventListener("resize", this.onResize);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.el.classList.add("is-hidden");
    this.doc.removeEventListener("mousedown", this.onDown, true);
    this.doc.removeEventListener("scroll", this.onScroll, true);
    this.win.removeEventListener("resize", this.onResize);
    this.opts.onClose?.();
  }

  /** Recoloca el desplegable (p. ej. si su contenido cambió de tamaño). */
  place(): void {
    if (!this.opened) return;
    const r = this.trigger.getBoundingClientRect();
    const vh = this.win.innerHeight || 800;
    const vw = this.win.innerWidth || 1200;
    const margin = 8;
    const cap = this.opts.maxHeight ?? 360;
    const below = vh - r.bottom - margin;
    const above = r.top - margin;
    // Debajo si cabe razonablemente; si no, donde haya más sitio
    const useBelow = below >= Math.min(cap, 200) || below >= above;
    const room = Math.max(120, useBelow ? below : above);
    const width = Math.max(this.opts.minWidth ?? 0, r.width);
    const left = Math.min(Math.max(margin, r.left), Math.max(margin, vw - Math.max(width, this.el.offsetWidth) - margin));
    if (useBelow) {
      this.el.setCssStyles({
        maxHeight: `${Math.min(cap, room)}px`,
        minWidth: `${width}px`,
        maxWidth: `${Math.max(240, vw - margin * 2)}px`,
        left: `${left}px`,
        top: `${r.bottom + 2}px`,
        bottom: "auto",
      });
    } else {
      this.el.setCssStyles({
        maxHeight: `${Math.min(cap, room)}px`,
        minWidth: `${width}px`,
        maxWidth: `${Math.max(240, vw - margin * 2)}px`,
        left: `${left}px`,
        bottom: `${vh - r.top + 2}px`,
        top: "auto",
      });
    }
  }

  /** Quita el desplegable del documento (al cerrar la vista). */
  destroy(): void {
    this.close();
    this.el.remove();
    Floating.all.delete(this);
  }
}

/** Botón redondo «?» que abre una ayuda flotante con el contenido que construye `build`. */
export function helpButton(parent: HTMLElement, build: (box: HTMLElement) => void, title = "Ayuda"): { button: HTMLElement; floating: Floating } {
  const button = parent.createEl("button", { cls: "zl-help-btn", text: "?", attr: { type: "button", title } });
  const box = parent.createDiv({ cls: "zl-help" });
  build(box);
  const floating = new Floating(button, box, { cls: "zl-float-help", maxHeight: 320, minWidth: 260 });
  button.addEventListener("click", () => floating.toggle());
  return { button, floating };
}

/** Una fila de chuleta: la sintaxis en monoespaciado y su explicación. */
export function helpRow(box: HTMLElement, syntax: string, text: string): void {
  const row = box.createDiv({ cls: "zl-help-row" });
  row.createEl("code", { text: syntax });
  row.createSpan({ text });
}

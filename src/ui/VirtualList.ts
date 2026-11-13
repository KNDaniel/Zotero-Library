export interface VirtualListOptions<T> {
  /** Alto fijo de cada fila, en px */
  rowHeight: number;
  /** Filas extra que se dibujan por encima y por debajo de lo visible */
  overscan?: number;
  renderRow(row: HTMLElement, item: T, index: number): void;
}

/**
 * Lista con ventana: solo se dibujan las filas visibles. Hace falta para el
 * panel de etiquetas, que puede tener miles de entradas.
 */
export class VirtualList<T> {
  readonly el: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly rows: HTMLElement;
  private items: T[] = [];

  constructor(
    parent: HTMLElement,
    private readonly opts: VirtualListOptions<T>,
  ) {
    this.el = parent.createDiv({ cls: "zl-vlist" });
    this.spacer = this.el.createDiv({ cls: "zl-vlist-spacer" });
    this.rows = this.spacer.createDiv({ cls: "zl-vlist-rows" });
    this.el.addEventListener("scroll", () => this.draw());
  }

  get length(): number {
    return this.items.length;
  }

  setItems(items: T[], resetScroll = false): void {
    this.items = items;
    this.spacer.setCssStyles({ height: `${items.length * this.opts.rowHeight}px` });
    if (resetScroll) this.el.scrollTop = 0;
    this.draw();
  }

  /** Vuelve a dibujar las filas visibles (p. ej. tras cambiar una selección). */
  refresh(): void {
    this.draw();
  }

  /** Rango [primero, último) de filas que se dibujan ahora. */
  visibleRange(): [number, number] {
    const { rowHeight } = this.opts;
    const overscan = this.opts.overscan ?? 6;
    const height = this.el.clientHeight || 320;
    const top = this.el.scrollTop;
    const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
    const last = Math.min(this.items.length, Math.ceil((top + height) / rowHeight) + overscan);
    return [first, last];
  }

  private draw(): void {
    const [first, last] = this.visibleRange();
    this.rows.empty();
    this.rows.setCssStyles({ transform: `translateY(${first * this.opts.rowHeight}px)` });
    for (let i = first; i < last; i++) {
      const row = this.rows.createDiv({ cls: "zl-vrow" });
      row.setCssStyles({ height: `${this.opts.rowHeight}px` });
      this.opts.renderRow(row, this.items[i], i);
    }
  }
}

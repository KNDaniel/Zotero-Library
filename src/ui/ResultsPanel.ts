import { fileLinkToPath } from "../template/links";
import { helpButton, helpRow } from "./floating";
import { CONTENT_SCOPES, contentTerms, parseContentQuery, type ContentScope } from "../filter/content";
import type { AnnotationGroupKey, AnnotationSortKey, Group, ItemGroupKey, ItemSortKey } from "../filter/sortGroup";
import type { ZoteroAnnotation, ZoteroItem } from "../model/types";
import { OUTPUT_KINDS, type OutputKind, type OutputRequest, type OutputScope } from "../output/build";
import { LINK_TEMPLATES, LINK_TEMPLATE_PREFIX, linkTemplateById } from "../template/linkTemplates";
import type { OutputAction } from "../output/OutputService";
import { trace } from "../log";
import type { PanelHost } from "./ItemsPanel";
import { highlightTerms } from "./highlight";
import { ANNOTATION_GROUPS, ANNOTATION_SORTS, ITEM_GROUPS, ITEM_SORTS } from "./options";
import { toggleInList, type Derived, type ViewState } from "./state";
import { actionButton, segmented, selectControl, type Segmented, type SelectControl } from "./widgets";

/** Cómo se dibuja el contenido de una tarjeta (lo aporta la vista, que tiene las plantillas). */
export interface CardRenderer {
  /**
   * Huella de todo lo que afecta al aspecto de una tarjeta de anotación (datos, plantillas, ajustes).
   * Si se da, las tarjetas ya dibujadas con la misma huella se reutilizan en vez de dibujarse de nuevo.
   */
  signature?: string;
  item(body: HTMLElement, item: ZoteroItem): Promise<void>;
  annotation(body: HTMLElement, annotation: ZoteroAnnotation, position: number): Promise<void>;
}

export interface ResultsHost extends PanelHost {
  toggleTag(tag: string): void;
  /** Rutas de las plantillas de la carpeta configurada */
  templateNames(): string[];
  /** Saca el contenido (copiar, insertar, nota nueva) y devuelve el resumen para mostrar */
  runOutput(action: OutputAction, request: OutputRequest, scope: OutputScope): Promise<string>;
  /** Guarda las marcas de tarjetas en el estado sin redibujar nada (la tarjeta ya cambió de aspecto) */
  setMarks(marks: Partial<Pick<ViewState, "markedItems" | "markedAnnotations">>): void;
  /** Abre el explorador de datos con las variables de un ítem o de una anotación */
  explore(kind: "item" | "annotation", key: string): void;
  /** Abre un archivo local (los enlaces «Local» de las tarjetas, que Obsidian no abre por sí solo) */
  openLocal(path: string): void;
}

const COMMON_STYLES = ["apa", "chicago-author-date", "iso690-author-date-es", "modern-language-association", "harvard-cite-them-right"];

type Block =
  | { type: "group"; label: string; count: number }
  | { type: "item"; item: ZoteroItem }
  | { type: "annotation"; annotation: ZoteroAnnotation; position: number };

/** Tarjetas que se dibujan de golpe antes de ofrecer «Mostrar más». */
export const CHUNK = 30;
/** Tarjetas de anotación que se guardan ya dibujadas */
const CARD_CACHE_LIMIT = 800;

/** Panel de resultados: alterna entre metadata de ítems y anotaciones. */
export class ResultsPanel {
  readonly el: HTMLElement;
  private readonly modeSeg: Segmented<"item" | "annotation">;
  private readonly summary: HTMLElement;
  private readonly itemSort: SelectControl<ItemSortKey>;
  private readonly annSort: SelectControl<AnnotationSortKey>;
  private readonly itemGroup: SelectControl<ItemGroupKey>;
  private readonly annGroup: SelectControl<AnnotationGroupKey>;
  private readonly dirBtn: HTMLElement;
  private readonly contentInput: HTMLInputElement;
  private readonly contentScope: SelectControl<ContentScope>;
  /** Palabras de la búsqueda de contenido (normalizadas) que se resaltan en las tarjetas */
  private terms: string[] = [];
  private readonly body: HTMLElement;
  private readonly kindSel: SelectControl<OutputKind>;
  private readonly tplSel: HTMLSelectElement;
  private readonly styleBox: HTMLElement;
  private readonly styleInput: HTMLInputElement;
  private readonly outputButtons: HTMLElement[] = [];
  private readonly outputStatus: HTMLElement;
  private token = 0;
  private blocks: Block[] = [];
  private cursor = 0;
  private renderer: CardRenderer | null = null;
  private observer: IntersectionObserver | null = null;
  /** Contenedor de las tarjetas del grupo que se está dibujando (null si no hay grupos) */
  private cardsBox: HTMLElement | null = null;
  /** Tarjetas de anotación ya dibujadas (clave → contenido): reagrupar u ordenar no obliga a dibujarlas otra vez */
  private readonly cardCache = new Map<string, HTMLElement>();
  private cacheSignature: string | undefined;
  private cacheHits = 0;
  /** Medidas del último dibujado (solo para el registro de diagnóstico) */
  private blocksMs = 0;
  private chunkNo = 0;
  /** Claves de lo que se ve ahora en el modo actual: las marcas que no están aquí están ocultas por los filtros */
  private visible = new Set<string>();
  private readonly marksBar: HTMLElement;
  private readonly marksText: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly host: ResultsHost,
  ) {
    this.el = parent.createDiv({ cls: "zl-panel zl-results" });
    const head = this.el.createDiv({ cls: "zl-panel-head" });
    head.createEl("h3", { text: "Resultados" });
    this.summary = head.createSpan({ cls: "zl-count" });
    this.modeSeg = segmented(head, [
      { value: "item", label: "Ítems" },
      { value: "annotation", label: "Anotaciones" },
    ], (v) => this.host.patch({ mode: v }));

    const bar = this.el.createDiv({ cls: "zl-toolbar" });
    this.itemSort = selectControl(bar, ITEM_SORTS, (v) => this.host.patch({ itemSort: { ...this.host.state().itemSort, key: v } }));
    this.annSort = selectControl(bar, ANNOTATION_SORTS, (v) => this.host.patch({ annotationSort: { ...this.host.state().annotationSort, key: v } }));
    this.dirBtn = actionButton(bar, "↑", () => {
      const s = this.host.state();
      if (s.mode === "item") this.host.patch({ itemSort: { ...s.itemSort, dir: s.itemSort.dir === "asc" ? "desc" : "asc" } });
      else this.host.patch({ annotationSort: { ...s.annotationSort, dir: s.annotationSort.dir === "asc" ? "desc" : "asc" } });
    }, "Invertir el orden");
    this.itemGroup = selectControl(bar, ITEM_GROUPS, (v) => this.host.patch({ itemGroup: v }));
    this.annGroup = selectControl(bar, ANNOTATION_GROUPS, (v) => this.host.patch({ annotationGroup: v }));

    // --- Búsqueda de contenido de las anotaciones ---
    const find = this.el.createDiv({ cls: "zl-content-search" });
    const contentField = find.createDiv({ cls: "zl-field" });
    this.contentInput = contentField.createEl("input", { type: "search", cls: "zl-input", placeholder: "Buscar…" });
    this.contentInput.addEventListener("input", () => this.host.patch({ contentSearch: this.contentInput.value }));
    helpButton(contentField, (box) => {
      box.createDiv({ cls: "zl-help-title", text: "Buscar en las anotaciones" });
      helpRow(box, "clase obrera", "palabras separadas: deben aparecer todas");
      helpRow(box, "clase | proletariado", "| separa alternativas: basta con una");
      helpRow(box, "mayúsculas y tildes", "no cuentan: «Revolución» = «revolucion»");
    }, "Ayuda de la búsqueda");
    this.contentScope = selectControl(find, CONTENT_SCOPES, (v) => this.host.patch({ contentScope: v }));

    // --- Salida: copiar, insertar en la nota activa, nota nueva ---
    const out = this.el.createDiv({ cls: "zl-output" });
    out.createSpan({ cls: "zl-output-label", text: "Salida" });
    this.kindSel = selectControl(out, OUTPUT_KINDS, (v) => this.host.patch({ outputKind: v }));
    this.tplSel = out.createEl("select", { cls: "dropdown zl-select zl-output-template", attr: { title: "Plantilla de impresión" } });
    this.tplSel.addEventListener("change", () => {
      const s = this.host.state();
      this.host.patch({ outputTemplates: { ...s.outputTemplates, [s.outputKind]: this.tplSel.value } });
    });
    this.styleBox = out.createDiv({ cls: "zl-output-style" });
    this.styleInput = this.styleBox.createEl("input", { type: "text", cls: "zl-input", placeholder: "Estilo (los ajustes)", attr: { list: "zl-styles", title: "Estilo bibliográfico (identificador CSL)" } });
    this.styleInput.addEventListener("input", () => this.host.patch({ outputStyle: this.styleInput.value.trim() }));
    const dl = this.styleBox.createEl("datalist", { attr: { id: "zl-styles" } });
    for (const st of COMMON_STYLES) dl.createEl("option", { value: st });
    this.outputButtons.push(
      actionButton(out, "Copiar", () => void this.fire("copy", this.outputScope()), "Copia el resultado al portapapeles"),
      actionButton(out, "Insertar en la nota", () => void this.fire("insert", this.outputScope()), "Inserta el resultado en el cursor de la nota activa"),
      actionButton(out, "Nueva nota", () => void this.fire("note", this.outputScope()), "Crea una nota con el resultado"),
    );
    // Marcas: el contador y el botón para quitarlas (solo aparecen si hay alguna)
    this.marksBar = this.el.createDiv({ cls: "zl-marks is-hidden" });
    this.marksText = this.marksBar.createSpan({ cls: "zl-marks-text" });
    actionButton(this.marksBar, "Quitar marcas", () => this.clearMarks(), "Quita las marcas de este modo");
    this.outputStatus = this.el.createDiv({ cls: "zl-output-status" });

    this.body = this.el.createDiv({ cls: "zl-results-body" });
    // Los enlaces «Local» (file://) no los abre Obsidian de forma fiable: se abren con el sistema, igual que desde el menú del ítem.
    this.body.addEventListener(
      "click",
      (e) => {
        const a = (e.target as HTMLElement | null)?.closest?.("a");
        const path = a ? fileLinkToPath(a.getAttribute("href") ?? "", typeof process !== "undefined" ? process.platform : "linux") : null;
        if (!path) return;
        e.preventDefault();
        e.stopPropagation();
        this.host.openLocal(path);
      },
      true,
    );
    // Doble clic sobre una tarjeta: la marca (o desmarca) para la salida.
    this.body.addEventListener("dblclick", (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Los enlaces, botones, insignias e imágenes tienen su propio gesto.
      if (target?.closest?.("a, button, input, img, .zl-badge, .zl-card-actions, .internal-embed, .image-embed")) return;
      const card = target?.closest?.(".zl-card") as HTMLElement | null;
      const kind = card?.getAttribute("data-kind");
      const key = card?.getAttribute("data-key");
      if (!card || !key || (kind !== "item" && kind !== "annotation")) return;
      // El doble clic selecciona una palabra: se quita para que no quede texto seleccionado.
      card.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
      this.toggleMark(kind, key, card);
    });
  }

  /** Contenido ya dibujado de una tarjeta, si no está ahora mismo en pantalla (una anotación puede salir en varios grupos). */
  private takeCached(key: string): HTMLElement | null {
    const el = this.cardCache.get(key);
    if (!el || el.isConnected) return null;
    this.cardCache.delete(key); // se reinserta como la más reciente
    this.cardCache.set(key, el);
    return el;
  }

  private putCached(key: string, el: HTMLElement): void {
    this.cardCache.delete(key);
    this.cardCache.set(key, el);
    while (this.cardCache.size > CARD_CACHE_LIMIT) {
      const oldest = this.cardCache.keys().next().value;
      if (oldest === undefined) break;
      this.cardCache.delete(oldest);
    }
  }

  /** Lo que tardó en preparar la lista de bloques (agrupar y numerar) en el último dibujado */
  get lastBlocksMs(): number {
    return this.blocksMs;
  }

  /** Cuántas tarjetas del último dibujado salieron de la caché */
  get cachedCards(): number {
    return this.cacheHits;
  }

  private markList(kind: "item" | "annotation"): string[] {
    const s = this.host.state();
    return kind === "item" ? s.markedItems : s.markedAnnotations;
  }

  private toggleMark(kind: "item" | "annotation", key: string, card: HTMLElement): void {
    const list = toggleInList(this.markList(kind), key);
    this.host.setMarks(kind === "item" ? { markedItems: list } : { markedAnnotations: list });
    this.paintMark(card, list.includes(key));
    this.refreshMarks();
  }

  /** Aspecto de una tarjeta marcada: barra de acento y fondo teñido con el color de la anotación (sin insignia de texto). */
  private paintMark(card: HTMLElement, marked: boolean): void {
    card.toggleClass("is-marked", marked);
  }

  /** Alcance de «Copiar», «Insertar» y «Nueva nota»: las marcadas si las hay (se vean o no); si no, todo. */
  private outputScope(): OutputScope {
    const marks = this.markList(this.host.state().mode);
    if (!marks.length) return { type: "all" };
    const mode = this.host.state().mode;
    return { type: "marked", mode, items: mode === "item" ? marks : [], annotations: mode === "annotation" ? marks : [] };
  }

  private clearMarks(): void {
    const mode = this.host.state().mode;
    this.host.setMarks(mode === "item" ? { markedItems: [] } : { markedAnnotations: [] });
    for (const card of Array.from(this.body.querySelectorAll(`.zl-card.is-marked[data-kind="${mode}"]`)) as HTMLElement[]) this.paintMark(card, false);
    this.refreshMarks();
  }

  /** Contador de marcadas, aviso de las ocultas, ayudas de los botones y contador de cada grupo. */
  private refreshMarks(): void {
    const mode = this.host.state().mode;
    const stored = this.markList(mode);
    const hidden = stored.filter((k) => !this.visible.has(k)).length;
    const plural = (n: number) => `${n} marcada${n === 1 ? "" : "s"}`;
    this.marksBar.toggleClass("is-hidden", stored.length === 0);
    // Las marcas que los filtros ocultan se conservan y cuentan igual para la salida.
    const hiddenNote = hidden ? ` (${hidden} no se ve${hidden === 1 ? "" : "n"} con los filtros actuales, pero se saca${hidden === 1 ? "" : "n"} igual)` : "";
    this.marksText.setText(stored.length ? `${plural(stored.length)}: «Copiar», «Insertar» y «Nueva nota» usan solo las marcadas${hiddenNote}.` : "");
    const what = stored.length > 0 ? "las tarjetas marcadas" : "el resultado";
    const [copy, insert, note] = this.outputButtons;
    copy?.setAttribute("title", `Copia ${what} al portapapeles`);
    insert?.setAttribute("title", `Inserta ${what} en el cursor de la nota activa`);
    note?.setAttribute("title", `Crea una nota con ${what}`);
    // Un grupo plegado esconde sus marcas: su encabezado cuenta las que tiene.
    for (const wrap of Array.from(this.body.querySelectorAll(".zl-group-wrap")) as HTMLElement[]) {
      const n = wrap.querySelectorAll(".zl-card.is-marked").length;
      wrap.querySelector(".zl-group")?.setAttribute("data-marked", n ? ` · ${plural(n)}` : "");
    }
  }

  /** Lanza una salida y muestra su resumen (o el error) junto a los botones. */
  private async fire(action: OutputAction, scope: OutputScope, override: Partial<OutputRequest> = {}): Promise<void> {
    const s = this.host.state();
    // Los botones de cada tarjeta: un ítem usa el tipo elegido (salvo «solo anotaciones»); una anotación, siempre «solo anotaciones»
    // (salvo con «Enlace Markdown», que también vale para anotaciones).
    const kind: OutputKind =
      s.outputKind === "link" ? "link" : scope.type === "annotation" ? "annotations" : scope.type === "item" && s.outputKind === "annotations" ? "full" : s.outputKind;
    const request: OutputRequest = { kind, mode: s.mode, template: s.outputTemplates[kind] ?? "", style: s.outputStyle, ...override };
    this.outputStatus.setText("Preparando…");
    this.outputStatus.toggleClass("is-error", false);
    try {
      this.outputStatus.setText(`✓ ${await this.host.runOutput(action, request, scope)}${scope.type === "marked" ? " · solo las marcadas" : ""}`);
    } catch (e) {
      this.outputStatus.setText(`⚠️ ${(e as Error).message}`);
      this.outputStatus.toggleClass("is-error", true);
    }
  }

  /** Contenedor desplazable, para delegar clics (enlaces internos de las tarjetas). */
  get scrollEl(): HTMLElement {
    return this.body;
  }

  /** Cuántas tarjetas hay dibujadas ahora mismo. */
  get renderedCards(): number {
    return this.body.querySelectorAll(".zl-card").length;
  }

  async update(d: Derived, s: ViewState, renderer: CardRenderer): Promise<void> {
    const token = ++this.token;
    this.renderer = renderer;
    if (renderer.signature !== this.cacheSignature) {
      this.cardCache.clear();
      this.cacheSignature = renderer.signature;
    }
    this.cacheHits = 0;
    const isItem = s.mode === "item";
    this.modeSeg.set(s.mode);
    this.itemSort.el.toggleClass("is-hidden", !isItem);
    this.annSort.el.toggleClass("is-hidden", isItem);
    this.itemGroup.el.toggleClass("is-hidden", !isItem);
    this.annGroup.el.toggleClass("is-hidden", isItem);
    this.itemSort.set(s.itemSort.key);
    this.annSort.set(s.annotationSort.key);
    this.itemGroup.set(s.itemGroup);
    this.annGroup.set(s.annotationGroup);
    if (this.contentInput.value !== s.contentSearch && this.contentInput.ownerDocument.activeElement !== this.contentInput) this.contentInput.value = s.contentSearch;
    this.contentScope.set(s.contentScope);
    this.terms = contentTerms(parseContentQuery(s.contentSearch));
    const dir = isItem ? s.itemSort.dir : s.annotationSort.dir;
    this.dirBtn.setText(dir === "asc" ? "↑" : "↓");

    // Barra de salida
    this.kindSel.set(s.outputKind);
    const names = this.host.templateNames();
    this.tplSel.empty();
    this.tplSel.createEl("option", { text: "Por defecto", value: "", attr: { title: "La plantilla elegida en los ajustes; si no hay ninguna, la incluida en el plugin" } });
    // «Enlace Markdown» trae cinco plantillas con nombre propio, además de las de la carpeta de plantillas
    if (s.outputKind === "link") for (const t of LINK_TEMPLATES) this.tplSel.createEl("option", { text: t.label, value: LINK_TEMPLATE_PREFIX + t.id });
    for (const n of names) this.tplSel.createEl("option", { text: n, value: n });
    const chosen = s.outputTemplates[s.outputKind] ?? "";
    if (chosen && !names.includes(chosen) && !linkTemplateById(chosen)) this.tplSel.createEl("option", { text: `${chosen} (no encontrada)`, value: chosen });
    this.tplSel.value = chosen;
    this.styleBox.toggleClass("is-hidden", s.outputKind !== "bibliography");
    this.tplSel.toggleClass("is-hidden", false);
    if (this.styleInput.value !== s.outputStyle && this.styleInput.ownerDocument.activeElement !== this.styleInput) this.styleInput.value = s.outputStyle;
    for (const b of this.outputButtons) (b as HTMLButtonElement).disabled = d.selectedItems.length === 0;

    this.observer?.disconnect();
    this.body.empty();
    this.cardsBox = null;
    this.visible = new Set(isItem ? d.results.items.map((i) => i.key) : d.annotations.map((a) => a.key));
    const b0 = performance.now();
    this.blocks = this.buildBlocks(d, s);
    this.blocksMs = performance.now() - b0;
    this.chunkNo = 0;
    this.cursor = 0;
    this.refreshMarks();

    const total = [...d.results.allAnnotations.values()].reduce((n, l) => n + l.length, 0);
    if (isItem) this.summary.setText(d.selectedItems.length ? `${d.results.items.length} ítems` : "");
    else this.summary.setText(d.selectedItems.length ? `${d.annotations.length}${d.annotations.length !== total ? ` de ${total}` : ""} anotaciones` : "");

    if (d.selectedItems.length === 0) {
      this.body.createDiv({ cls: "zl-empty", text: "Selecciona uno o más ítems en el panel de ítems para ver aquí sus datos." });
      return;
    }
    if (this.blocks.length === 0) {
      this.body.createDiv({ cls: "zl-empty", text: isItem ? "No hay ítems que mostrar." : "Ninguna anotación coincide con la búsqueda o las etiquetas elegidas." });
      return;
    }
    await this.renderChunk(token);
  }

  private buildBlocks(d: Derived, s: ViewState): Block[] {
    const blocks: Block[] = [];
    const addGroupHeader = (g: Group<unknown>) => {
      if (g.label) blocks.push({ type: "group", label: g.label, count: g.entries.length });
    };
    if (s.mode === "item") {
      for (const g of d.itemGroups) {
        addGroupHeader(g);
        for (const item of g.entries) blocks.push({ type: "item", item });
      }
    } else {
      const position = new Map<string, number>();
      d.annotations.forEach((a, i) => position.set(a.key, i + 1));
      for (const g of d.annotationGroups) {
        addGroupHeader(g);
        for (const annotation of g.entries) blocks.push({ type: "annotation", annotation, position: position.get(annotation.key) ?? 0 });
      }
    }
    return blocks;
  }

  /** Dibuja el siguiente lote de tarjetas; el resto espera a «Mostrar más». */
  private async renderChunk(token: number): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    this.body.querySelector(".zl-more")?.remove();
    const c0 = performance.now();
    const chunkNo = this.chunkNo++;
    let cards = 0;
    let chunkHits = 0;
    const missMs: number[] = [];
    const pending: Array<Promise<void>> = [];
    while (this.cursor < this.blocks.length && cards < CHUNK) {
      const b = this.blocks[this.cursor++];
      if (b.type === "group") {
        const wrap = this.body.createDiv({ cls: "zl-group-wrap" });
        const head = wrap.createEl("h4", {
          cls: "zl-group",
          text: `${b.label} (${b.count})`,
          attr: { role: "button", tabindex: "0", "aria-expanded": "true", title: "Plegar o desplegar el grupo (no cambia lo que se saca)" },
        });
        const groupLabel = b.label;
        const toggle = () => {
          const folded = !wrap.hasClass("is-collapsed");
          // Cuenta antes de medir: el registro no debe sumarse al tiempo del plegado.
          const inGroup = wrap.querySelectorAll(".zl-card").length;
          const onScreen = this.body.querySelectorAll(".zl-card").length;
          const t0 = performance.now();
          wrap.toggleClass("is-collapsed", folded);
          head.setAttribute("aria-expanded", String(!folded));
          this.measureToggle(groupLabel, folded, t0, inGroup, onScreen);
        };
        head.addEventListener("click", toggle);
        head.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        });
        this.cardsBox = wrap.createDiv({ cls: "zl-group-cards" });
        continue;
      }
      cards++;
      const card = (this.cardsBox ?? this.body).createDiv({ cls: "zl-card" });
      card.setAttribute("data-kind", b.type);
      card.setAttribute("data-key", b.type === "item" ? b.item.key : b.annotation.key);
      const content = card.createDiv({ cls: "zl-card-body" });
      const scope: OutputScope = b.type === "item" ? { type: "item", key: b.item.key } : { type: "annotation", key: b.annotation.key };
      if (b.type === "item") {
        pending.push(renderer.item(content, b.item));
        if (b.item.fromAttachment) card.createDiv({ cls: "zl-attachment-note", text: "Adjunto sin contenedor: no tiene ítem en Zotero, solo el archivo y sus anotaciones." });
      } else {
        const a = b.annotation;
        if (a.color) {
          card.setCssStyles({ borderLeftColor: a.color });
          card.setCssProps({ "--zl-card-color": a.color }); // también tiñe el fondo cuando la tarjeta está marcada
        }
        card.addClass("zl-card-annotation");
        const terms = this.terms;
        // La posición y los términos resaltados forman parte de la clave: cambian lo que se ve dentro de la tarjeta.
        const cacheKey = renderer.signature === undefined ? null : `${renderer.signature}\u0001${a.key}\u0001${b.position}\u0001${terms.join("\u0002")}`;
        const cached = cacheKey ? this.takeCached(cacheKey) : null;
        if (cached) {
          content.replaceWith(cached);
          this.cacheHits++;
          chunkHits++;
        } else {
          pending.push(
            renderer.annotation(content, a, b.position).then(() => {
              if (token !== this.token) return; // una actualización posterior invalida este render y su caché
              missMs.push(performance.now() - c0);
              highlightTerms(content, terms);
              if (cacheKey && !content.querySelector(".zl-error")) this.putCached(cacheKey, content);
            }),
          );
        }
        this.renderBadges(card, a);
      }
      // Siempre lo último de la tarjeta: debajo del contenido y de las insignias.
      const actions = card.createDiv({ cls: "zl-card-actions" });
      actionButton(actions, "Copiar", () => void this.fire("copy", scope), "Copia solo este resultado");
      actionButton(actions, "Insertar", () => void this.fire("insert", scope), "Inserta solo este resultado en la nota activa");
      actionButton(actions, "ID", () => void this.fire("copy", scope, { kind: "link", template: `${LINK_TEMPLATE_PREFIX}id` }), b.type === "item" ? "Copia la clave de Zotero de este ítem" : "Copia la clave de Zotero de esta anotación");
      actionButton(actions, "Datos", () => this.host.explore(b.type, b.type === "item" ? b.item.key : b.annotation.key), "Explora las variables de esta tarjeta para usarlas en una plantilla");
      if (this.markList(b.type).includes(b.type === "item" ? b.item.key : b.annotation.key)) this.paintMark(card, true);
    }
    const loopMs = performance.now() - c0;
    await Promise.all(pending);
    const totalMs = performance.now() - c0;
    if (token !== this.token) return; // llegó una actualización más reciente
    this.refreshMarks();
    this.logChunk(chunkNo, cards, chunkHits, missMs, loopMs, totalMs);

    if (this.cursor < this.blocks.length) {
      const more = this.body.createDiv({ cls: "zl-more" });
      const left = this.blocks.slice(this.cursor).filter((b) => b.type !== "group").length;
      const btn = actionButton(more, `Mostrar más (${left} restantes)`, () => void this.renderChunk(this.token));
      // Si hay IntersectionObserver, el siguiente lote se pide solo al llegar al final.
      if (typeof IntersectionObserver !== "undefined") {
        this.observer = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            this.observer?.disconnect();
            void this.renderChunk(this.token);
          }
        }, { root: this.body });
        this.observer.observe(btn);
      }
    }
  }

  /** Registro de diagnóstico de un lote: cuánto cuesta dibujar y si cambia al crecer el número de tarjetas en pantalla. */
  private logChunk(chunkNo: number, cards: number, hits: number, missMs: number[], loopMs: number, totalMs: number): void {
    const onScreen = this.body.querySelectorAll(".zl-card").length;
    const misses = cards - hits;
    const first = missMs.length ? Math.min(...missMs) : 0;
    const last = missMs.length ? Math.max(...missMs) : 0;
    // Solo los lotes lentos o el primero: una línea por cada 30 tarjetas llenaría el registro.
    if (totalMs < 200 && chunkNo > 0) return;
    const f = (n: number) => n.toFixed(0);
    trace.log(
      `vista: lote ${chunkNo} → ${cards} tarjetas (${hits} reutilizadas, ${misses} nuevas) en ${f(totalMs)} ms ` +
        `[bucle síncrono ${f(loopMs)} ms; primera nueva a ${f(first)} ms, última a ${f(last)} ms; preparar bloques ${f(this.blocksMs)} ms] ` +
        `· ${onScreen} tarjetas en pantalla`,
    );
  }

  /** Mide cuánto tarda en verse un grupo plegado o desplegado (cambio de clase, estilos y pintado). */
  private measureToggle(label: string, folded: boolean, t0: number, inGroup: number, onScreen: number): void {
    const syncMs = performance.now() - t0;
    const raf = (typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: () => void) => window.setTimeout(cb, 0)) as (cb: () => void) => unknown;
    raf(() => {
      const styleMs = performance.now() - t0;
      raf(() => {
        const paintedMs = performance.now() - t0;
        if (paintedMs < 200) return; // solo se anota lo que se nota
        trace.log(
          `vista: grupo «${label}» ${folded ? "plegado" : "desplegado"}: cambio ${syncMs.toFixed(0)} ms, ` +
            `hasta el siguiente cuadro ${styleMs.toFixed(0)} ms, hasta pintado ${paintedMs.toFixed(0)} ms ` +
            `(${inGroup} tarjetas en el grupo, ${onScreen} en pantalla)`,
        );
      });
    });
  }

  /** Insignias de las etiquetas de la anotación, (de)seleccionables. */
  private renderBadges(card: HTMLElement, a: ZoteroAnnotation): void {
    const tags = [...new Set(a.tags.map((t) => t.tag))];
    if (!tags.length) return;
    const selected = new Set(this.host.state().selectedTags);
    const box = card.createDiv({ cls: "zl-badges" });
    for (const t of tags) {
      const badge = box.createSpan({ cls: "zl-badge", text: t, attr: { title: t } });
      badge.toggleClass("is-selected", selected.has(t));
      badge.addEventListener("click", () => this.host.toggleTag(t));
    }
  }
}

import { Floating } from "./floating";
import { formatSyncDate } from "./syncDate";
import { ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from "obsidian";
import { trace } from "../log";
import type { LibraryIndex } from "../index/LibraryIndex";
import type { PreviewImage } from "../markdown";
import type { ZoteroLibrarySettings } from "../settings";
import { itemContext, standaloneAnnotationContext, type ContextOptions } from "../template/context";
import { DEFAULT_ANNOTATION_RENDER, DEFAULT_ITEM_RENDER } from "../template/defaults";
import type { TemplateEngine } from "../template/engine";
import { oneLine, resolveRowFormat } from "../template/rowFormats";
import type { ZoteroItem } from "../model/types";
import type { OutputRequest, OutputScope } from "../output/build";
import type { OutputAction } from "../output/OutputService";
import type { ExplorerStart } from "./explorer";
import { ItemsPanel, itemLabel, type ItemsHost, type PanelHost } from "./ItemsPanel";
import { stripFrontmatter } from "../markdown";
import { previewImages } from "./markdown";
import { ResultsPanel, type CardRenderer } from "./ResultsPanel";
import { derive, persistableState, restoreState, toggleInList, type Derived, type ViewState } from "./state";
import { TagsPanel } from "./TagsPanel";

export const VIEW_TYPE = "zotero-library-view";
type ActivePanel = "items" | "tags" | "results";

/** Lo que la vista necesita del plugin (evita una dependencia circular). */
export interface ViewHost {
  /** Versión del plugin, para mostrarla en la barra superior */
  version: string;
  settings: ZoteroLibrarySettings;
  getIndex(): LibraryIndex | null;
  loadLibrary(announce: boolean, onProgress?: (loaded: number, total: number) => void): Promise<LibraryIndex | null>;
  /** Abre la biblioteca desde la copia en disco (null si no hay) */
  loadFromCache(): Promise<LibraryIndex | null>;
  /** Pone la biblioteca al día (solo los cambios, o todo si hace falta) */
  syncLibrary(): Promise<{ status: "unchanged" | "incremental" | "full" | "offline" | "failed"; index: LibraryIndex | null; message?: string; ms: number }>;
  /** Rutas de las plantillas de la carpeta configurada */
  templatePaths(): string[];
  /** Saca el resultado (copiar, insertar, nota nueva) con lo que muestra la vista ahora mismo */
  runOutput(action: OutputAction, request: OutputRequest, scope: OutputScope, d: Derived): Promise<string>;
  /** Fecha de la copia en disco con la que se abrió, si se usó */
  cacheInfo: { savedAt: number; ms: number } | null;
  /** Última sincronización correcta con Zotero (ms desde 1970), si se conoce */
  lastSyncAt(): number | null;
  /** Menú contextual de un ítem de la lista (abrir y encontrar, en Zotero y en local) */
  showItemMenu(item: ZoteroItem, e: MouseEvent): void;
  /** Abre un archivo local con la aplicación predeterminada del sistema (enlace «Local» de las tarjetas) */
  openLocalFile(path: string): void;
  createEngine(): Promise<{ engine: TemplateEngine; templates: Map<string, string> }>;
  contextOptions(engine: TemplateEngine): ContextOptions;
  saveSettings(): Promise<void>;
  /** Abre el explorador de datos de un ítem o de una anotación */
  openExplorer(start: ExplorerStart): Promise<void>;
}

const imagesOf = (list: Array<Record<string, unknown>>): PreviewImage[] =>
  list
    .filter((a) => a.imageRelativePath && a.imagePath)
    .map((a) => ({ relativePath: String(a.imageRelativePath), absolutePath: String(a.imagePath) }));

/** Vista principal: panel de ítems, panel de etiquetas y panel de resultados. */
export class ZoteroLibraryView extends ItemView {
  private state: ViewState;
  private index: LibraryIndex | null = null;
  /** Número de cada índice cargado: cambia cuando llegan datos nuevos y así se vacía la caché de tarjetas */
  private readonly indexIds = new WeakMap<LibraryIndex, number>();
  private nextIndexId = 1;
  private items: ItemsPanel | null = null;
  private tags: TagsPanel | null = null;
  private results: ResultsPanel | null = null;
  private layout!: HTMLElement;
  private panelTabs!: HTMLElement;
  private readonly panelTabButtons = new Map<ActivePanel, HTMLButtonElement>();
  private activePanel: ActivePanel = "results";
  private origin!: HTMLElement;
  private status!: HTMLElement;
  private syncing = false;
  /** Cómo se abrió la biblioteca; se mantiene a la vista junto al estado de la sincronización */
  private refreshes = 0;
  private lastDeriveMs = 0;
  /** Se resuelve cuando la biblioteca ya está cargada y los paneles montados */
  ready: Promise<void> = Promise.resolve();
  private phase: "loading" | "ready" | "failed" = "loading";

  /** Estado de la vista: cargando, lista o fallida (para reabrirla si quedó rota). */
  health(): "loading" | "ready" | "failed" {
    return this.phase;
  }
  /** Formato de fila vigente: plantilla ya resuelta, motor y caché de textos por ítem */
  private rowSource = "";
  private rowName = "";
  private rowEngine: TemplateEngine | null = null;
  private rowOpts: ContextOptions | null = null;
  private readonly rowCache = new Map<string, string>();
  private rowError = "";
  private resultsTimer: number | undefined;
  private saveTimer: number | undefined;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: ViewHost,
  ) {
    super(leaf);
    trace.log("vista: constructor");
    try {
      this.state = restoreState(host.settings.viewState);
    } catch (e) {
      trace.error("restoreState", e);
      this.state = restoreState(undefined);
    }
  }

  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return "Zotero Library";
  }
  getIcon(): string {
    return "library";
  }

  async onOpen(): Promise<void> {
    trace.log("vista: onOpen empieza");
    const root = this.contentEl;
    root.empty();
    root.addClass("zl-view");

    const bar = root.createDiv({ cls: "zl-topbar" });
    bar.createSpan({ cls: "zl-count zl-version", text: `v${this.host.version}` });
    this.origin = bar.createSpan({ cls: "zl-count zl-origin" });
    this.status = bar.createSpan({ cls: "zl-count zl-status" });
    const sync = bar.createEl("button", { cls: "zl-btn", text: "Sincronizar con Zotero", attr: { type: "button", title: "Trae los cambios de Zotero desde la última sincronización" } });
    sync.addEventListener("click", () => void this.sync());
    this.panelTabs = root.createDiv({ cls: "zl-panel-tabs is-hidden", attr: { role: "group", "aria-label": "Mostrar panel" } });
    for (const [key, label] of [["items", "Ítems"], ["tags", "Etiquetas"], ["results", "Resultados"]] as const) {
      const button = this.panelTabs.createEl("button", { cls: "zl-panel-tab", text: label, attr: { type: "button", "aria-pressed": "false" } });
      button.addEventListener("click", () => this.activatePanel(key));
      this.panelTabButtons.set(key, button);
    }
    this.layout = root.createDiv({ cls: "zl-layout" });

    // onOpen debe volver enseguida: Obsidian no muestra la vista hasta que termina.
    // La carga (que puede tardar decenas de segundos la primera vez) va aparte.
    this.ready = this.openLibrary().catch((e: unknown) => {
      this.phase = "failed";
      trace.error("abrir la vista", e);
      this.message(`No se pudo abrir la vista: ${(e as Error)?.message ?? e}\nMira «Mostrar el registro de diagnóstico de Zotero Library» en la paleta de comandos.`);
    });
    trace.log("vista: onOpen termina (la carga sigue en segundo plano)");
  }

  async onClose(): Promise<void> {
    Floating.sweep(this.contentEl);
    window.clearTimeout(this.resultsTimer);
    window.clearTimeout(this.saveTimer);
  }

  private setStatus(text: string, tooltip = ""): void {
    this.status.setText(text);
    if (tooltip) this.status.setAttribute("title", tooltip);
    else this.status.removeAttribute("title");
  }

  /** «Local 1839 ms» (azul) si se abrió desde la copia en disco; «Zotero 54.9 s» (rojo) si se cargó de Zotero. */
  private setOrigin(from: "cache" | "zotero" | "other", ms: number): void {
    this.origin.className = "zl-count zl-origin";
    this.origin.setText("");
    this.origin.removeAttribute("title");
    if (from === "cache") {
      this.origin.addClass("is-local");
      this.origin.createSpan({ cls: "zl-origin-name", text: "Local" });
      this.origin.createSpan({ text: ` ${ms} ms` });
      this.origin.setAttribute("title", "Abierta desde la copia en disco");
    } else if (from === "zotero") {
      this.origin.addClass("is-zotero");
      this.origin.createSpan({ cls: "zl-origin-name", text: "Zotero" });
      this.origin.createSpan({ text: ` ${(ms / 1000).toFixed(1)} s` });
      this.origin.setAttribute("title", "Cargada desde Zotero");
    }
  }

  private lastSyncText(): string | null {
    const at = this.host.lastSyncAt();
    return at ? `Última sincronización ${formatSyncDate(at)}` : null;
  }

  private message(text: string): HTMLElement {
    this.layout.empty();
    Floating.sweep();
    return this.layout.createDiv({ cls: "zl-empty", text });
  }

  /**
   * Abre al instante desde la memoria o la copia en disco y sincroniza en
   * segundo plano; solo si no hay nada de eso carga todo desde Zotero.
   */
  /**
   * OJO con los nombres: `open`, `close`, `load`, `unload`… son métodos de Obsidian (algunos
   * internos, que TypeScript no ve). Sobrescribir `open()` rompió la vista en la 0.5.0.
   */
  private async openLibrary(): Promise<void> {
    const t0 = Date.now();
    let index = this.host.getIndex();
    trace.log(`vista: openLibrary() — índice en memoria: ${index ? "sí" : "no"}`);
    let from: "memory" | "cache" | "zotero" = "memory";
    if (!index) {
      this.message("Abriendo la biblioteca desde la copia en disco…");
      index = await this.host.loadFromCache();
      from = "cache";
    }
    if (!index) {
      from = "zotero";
      const text = this.message("Cargando la biblioteca de Zotero…");
      const render = (extra: string) =>
        text.setText(`Cargando la biblioteca de Zotero… ${extra}\nLa primera vez puede tardar; después se abrirá al instante desde la copia en disco.`);
      let progress = "";
      const tick = window.setInterval(() => render(`${progress}${Math.round((Date.now() - t0) / 1000)} s`), 1000);
      try {
        index = await this.host.loadLibrary(false, (loaded, total) => (progress = `${loaded}/${total} · `));
      } finally {
        window.clearInterval(tick);
      }
    }
    if (!index) {
      this.phase = "failed";
      trace.log("vista: no se pudo cargar la biblioteca");
      this.message("No se pudo cargar la biblioteca. Usa el comando «Diagnosticar la conexión con Zotero».");
      return;
    }
    trace.log(`vista: índice disponible (${from}) tras ${Date.now() - t0} ms; montando paneles`);
    this.layout.empty();
    Floating.sweep();
    this.showIndex(index);
    this.phase = "ready";
    trace.log(`vista: paneles montados tras ${Date.now() - t0} ms`);
    const ms = Date.now() - t0;
    this.setOrigin(from === "cache" || from === "zotero" ? from : "other", ms);
    if (from === "zotero") this.setStatus("Sincronizado", this.lastSyncText() ?? "");
    else void this.sync();
  }

  private showIndex(index: LibraryIndex): void {
    this.index = index;
    this.mount();
  }

  /** Sincroniza con Zotero; solo redibuja los paneles si hubo cambios. */
  private async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    this.setStatus("Sincronizando con Zotero…");
    try {
      const r = await this.host.syncLibrary();
      if (r.status === "incremental" || r.status === "full") {
        if (r.index) {
          // Mantén los paneles montados: conservan scroll, secciones plegadas y
          // estado local. Sus hosts consultan this.index para usar el índice actual.
          this.index = r.index;
          this.rowCache.clear();
          Floating.sweep(this.layout);
          this.refresh();
        }
        this.setStatus("Sincronizado", `${r.status === "incremental" ? "Cambios aplicados" : "Biblioteca recargada"} en ${r.ms} ms · ${this.lastSyncText() ?? ""}`);
      } else if (r.status === "unchanged") {
        this.setStatus("Sincronizado", `Al día (${r.ms} ms) · ${this.lastSyncText() ?? ""}`);
      } else if (r.status === "offline") {
        this.setStatus(this.lastSyncText() ?? "Sin sincronizar todavía", "Zotero no responde: se muestran los datos guardados");
      } else {
        this.setStatus(`No se pudo sincronizar: ${r.message ?? "error desconocido"}`);
      }
    } finally {
      this.syncing = false;
    }
  }

  private mount(): void {
    trace.log("vista: mount empieza");
    const panelHost: PanelHost = {
      state: () => this.state,
      patch: (p) => this.patch(p),
      index: () => this.index!,
    };
    const left = this.layout.createDiv({ cls: "zl-left" });
    const right = this.layout.createDiv({ cls: "zl-right" });
    this.rowCache.clear();
    const itemsHost: ItemsHost = {
      ...panelHost,
      templateNames: () => this.host.templatePaths(),
      rowLabel: (item) => this.rowLabel(item),
      onItemMenu: (item, e) => this.host.showItemMenu(item, e),
    };
    this.items = new ItemsPanel(left, itemsHost);
    this.tags = new TagsPanel(left, panelHost);
    this.results = new ResultsPanel(right, {
      ...panelHost,
      toggleTag: (t) => this.patch({ selectedTags: toggleInList(this.state.selectedTags, t) }),
      templateNames: () => this.host.templatePaths(),
      // Las marcas cambian el aspecto de la tarjeta, no los datos: se guardan sin redibujar los resultados.
      setMarks: (marks) => void Object.assign(this.state, marks),
      explore: (kind, key) => void this.host.openExplorer({ kind, key, selectedKeys: this.state.selectedItems }),
      openLocal: (path) => this.host.openLocalFile(path),
      runOutput: (action, request, scope) => {
        if (!this.index) return Promise.reject(new Error("La biblioteca no está cargada."));
        return this.host.runOutput(action, request, scope, derive(this.index, this.state));
      },
    });

    this.panelTabs.removeClass("is-hidden");
    this.activatePanel(this.activePanel);

    // Los enlaces internos de las tarjetas ([[nota]]) no los gestiona Obsidian fuera de un editor.
    this.registerDomEvent(this.results.scrollEl, "click", (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a.internal-link") as HTMLElement | null;
      const href = a?.getAttribute("data-href") ?? a?.getAttribute("href");
      if (a && href) {
        e.preventDefault();
        void this.app.workspace.openLinkText(href, "", e.ctrlKey || e.metaKey);
      }
    });
    this.refresh();
  }

  /** En vistas estrechas se muestra un panel por vez; en escritorio las tres columnas siguen visibles. */
  private activatePanel(panel: ActivePanel): void {
    this.activePanel = panel;
    for (const [key, button] of this.panelTabButtons) button.setAttribute("aria-pressed", String(key === panel));
    const panels: Record<ActivePanel, HTMLElement | null> = {
      items: this.items?.el ?? null,
      tags: this.tags?.el ?? null,
      results: this.results?.el ?? null,
    };
    for (const [key, el] of Object.entries(panels) as [ActivePanel, HTMLElement | null][]) {
      if (!el) continue;
      el.toggleClass("is-active-panel", key === panel);
    }
    // Al estar ocultas con display:none las listas virtuales se dibujaron con su altura de reserva.
    if (panel === "items") this.items?.refreshViewport();
    if (panel === "tags") this.tags?.refreshViewport();
  }

  private patch(p: Partial<ViewState>): void {
    Object.assign(this.state, p);
    this.refresh();
  }

  /** Recalcula todo a partir del estado y actualiza los tres paneles. */
  private refresh(): void {
    if (!this.index || !this.items || !this.tags || !this.results) return;
    const r0 = Date.now();
    const d0 = performance.now();
    const d = derive(this.index, this.state);
    this.lastDeriveMs = performance.now() - d0;
    // La selección de ítems solo pierde los que ya no existen; la de etiquetas, las que dejan de estar disponibles.
    if (d.selectedItems.join() !== this.state.selectedItems.join()) this.state.selectedItems = d.selectedItems;
    // Las marcas duran lo que dure la selección de su ítem.
    if (d.markedItems.join() !== this.state.markedItems.join()) this.state.markedItems = d.markedItems;
    if (d.markedAnnotations.join() !== this.state.markedAnnotations.join()) this.state.markedAnnotations = d.markedAnnotations;
    const tags = [...d.selectedTags];
    if (tags.join() !== this.state.selectedTags.join()) this.state.selectedTags = tags;

    this.items.update(d);
    this.tags.update(d);
    this.scheduleResults(d);
    this.scheduleSave();
    const took = Date.now() - r0;
    if (took > 300 || this.refreshes++ < 2) trace.log(`vista: refresh en ${took} ms, de ellos derive ${this.lastDeriveMs.toFixed(0)} ms (${d.available.length} disponibles, ${d.selectedItems.length} seleccionados, orden ${this.state.mode === "item" ? this.state.itemSort.key : this.state.annotationSort.key}, agrupación ${this.state.mode === "item" ? this.state.itemGroup : this.state.annotationGroup})`);
  }

  private scheduleResults(d: Derived): void {
    window.clearTimeout(this.resultsTimer);
    this.resultsTimer = window.setTimeout(() => void this.renderResults(d), 80);
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.host.settings.viewState = persistableState(this.state);
      void this.host.saveSettings();
    }, 600);
  }

  /**
   * Texto de una fila de la lista según el formato elegido. Hasta que se carga el
   * motor de plantillas (y si la plantilla falla) usa «Autor (Año) — Título».
   */
  private rowLabel(item: ZoteroItem): string {
    const cached = this.rowCache.get(item.key);
    if (cached !== undefined) return cached;
    let text: string;
    if (!this.rowEngine || !this.rowOpts || !this.index) {
      text = itemLabel(item);
    } else {
      try {
        text = oneLine(this.rowEngine.render(this.rowSource, itemContext(this.index, item, [], [], this.rowOpts), this.rowName || "(formato de fila)")) || itemLabel(item);
      } catch (e) {
        if (this.rowError !== this.rowName) {
          this.rowError = this.rowName;
          new Notice(`Error en el formato de fila «${this.rowName}»: ${(e as Error).message}`, 8000);
        }
        text = itemLabel(item);
      }
    }
    this.rowCache.set(item.key, text);
    return text;
  }

  /** Adopta el formato de fila elegido (con el motor y las plantillas de ahora) y redibuja la lista si cambió. */
  private syncRowFormat(engine: TemplateEngine, templates: Map<string, string>, opts: ContextOptions): void {
    const r = resolveRowFormat(this.state.rowFormat, this.host.settings.defaultRowFormat, templates);
    if (r.missing && this.rowError !== `missing:${r.missing}`) {
      this.rowError = `missing:${r.missing}`;
      new Notice(`No encuentro el formato de fila «${r.missing}»: se usa «Autor (Año) — Título».`, 6000);
    }
    this.rowEngine = engine;
    this.rowOpts = opts;
    if (r.source === this.rowSource && r.name === this.rowName) return;
    this.rowSource = r.source;
    this.rowName = r.name;
    this.rowCache.clear();
    this.items?.redrawRows();
  }

  /** Dibuja el panel de resultados con las plantillas de renderizado. */
  async renderResults(d: Derived): Promise<void> {
    if (!this.results || !this.index) return;
    try {
      const r0 = Date.now();
      await this.results.update(d, this.state, await this.makeRenderer(d, this.index));
      const took = Date.now() - r0;
      if (took > 500 || d.selectedItems.length) trace.log(`vista: resultados dibujados en ${took} ms (${this.results.renderedCards} tarjetas, ${this.results.cachedCards} reutilizadas, modo ${this.state.mode}, orden ${this.state.mode === "item" ? this.state.itemSort.key : this.state.annotationSort.key}, agrupación ${this.state.mode === "item" ? this.state.itemGroup : this.state.annotationGroup}; derive ${this.lastDeriveMs.toFixed(0)} ms)`);
    } catch (e) {
      trace.error("renderResults", e);
      new Notice(`No se pudieron mostrar los resultados: ${(e as Error).message}`, 8000);
      console.error("[zotero-library]", e);
    }
  }

  private async makeRenderer(d: Derived, index: LibraryIndex): Promise<CardRenderer> {
    const { engine, templates } = await this.host.createEngine();
    const settings = this.host.settings;
    const itemName = settings.defaultItemRender;
    const annName = settings.defaultAnnotationRender;
    const itemSource = (itemName && templates.get(itemName)) || DEFAULT_ITEM_RENDER;
    const annSource = (annName && templates.get(annName)) || DEFAULT_ANNOTATION_RENDER;
    const opts = this.host.contextOptions(engine);
    this.syncRowFormat(engine, templates, opts);
    // Con la misma firma una tarjeta de anotación dibujada vale otra vez; si cambia algo que la afecta, se vuelve a dibujar.
    if (!this.indexIds.has(index)) this.indexIds.set(index, this.nextIndexId++);
    const signature = [this.indexIds.get(index), hashText([...templates].map(([k, v]) => `${k}\u0001${v}`).join("\u0000")), annName, settings.imagesFolder, settings.imageNameTemplate, settings.zoteroDataDir].join("\u0002");

    const draw = async (body: HTMLElement, make: () => { md: string; images: PreviewImage[] }): Promise<void> => {
      try {
        const { md, images } = make();
        body.empty();
        await MarkdownRenderer.render(this.app, previewImages(stripFrontmatter(md), images), body, "", this);
      } catch (e) {
        body.empty();
        body.createDiv({ cls: "zl-error", text: `Error en la plantilla: ${(e as Error).message}` });
      }
    };

    return {
      signature,
      item: (body, item) =>
        draw(body, () => {
          const ctx = itemContext(index, item, d.results.annotations.get(item.key) ?? [], d.results.allAnnotations.get(item.key) ?? [], opts);
          return { md: engine.render(itemSource, ctx, itemName || "(ítem por defecto)"), images: imagesOf(ctx.annotations as Array<Record<string, unknown>>) };
        }),
      annotation: (body, a, position) =>
        draw(body, () => {
          const ctx = standaloneAnnotationContext(index, a, opts, position);
          return { md: engine.render(annSource, ctx, annName || "(anotación por defecto)"), images: imagesOf([ctx.annotation as Record<string, unknown>]) };
        }),
    };
  }
}

/** Huella rápida de un texto (para comparar versiones de las plantillas, no para seguridad). */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

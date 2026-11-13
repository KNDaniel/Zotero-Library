import { createWatchdog } from "./watchdog";
import { promises as fsp } from "fs";
import { Menu, Notice, Plugin, TFile, moment, normalizePath } from "obsidian";
import { attachmentChoices, buildItemMenu, type MenuEntry, type OpenDeps } from "./services/itemActions";
import { trace } from "./log";
import { mergeChanges, packCache, unpackCache } from "./index/cache";
import { LibraryIndex } from "./index/LibraryIndex";
import { obsidianHttp } from "./obsidianHttp";
import { ReportModal } from "./ReportModal";
import { SearchPreviewModal } from "./SearchPreviewModal";
import { defaultSettings, type ZoteroLibrarySettings } from "./settings";
import { ZoteroConnectionError } from "./source/http";
import { nodeHttp } from "./nodeHttp";
import { CompareModal } from "./CompareModal";
import { DataExplorerModal, ItemPickerModal } from "./DataExplorerModal";
import { ConfirmReplaceModal, DefaultTemplatePicker } from "./DefaultTemplateModals";
import { diagnoseConnection, renderDiagnosis, type Transport } from "./source/diagnose";
import { LocalApiSource } from "./source/LocalApiSource";
import { withFallback } from "./source/resilient";
import type { RawLibrary } from "./source/ZoteroSource";
import { itemContext, type ContextOptions } from "./template/context";
import type { DefaultTemplateEntry } from "./template/defaultNotes";
import type { CopyKind, ExplorerSource, ExplorerStart } from "./ui/explorer";
import { itemLabel } from "./ui/ItemsPanel";
import { TemplateEngine, type MomentFn } from "./template/engine";
import { buildTemplateMap, isTemplatePath, listTemplates, relativeToFolder } from "./template/manager";
import { VIEW_TYPE, ZoteroLibraryView } from "./ui/ZoteroLibraryView";
import { ZoteroLibrarySettingTab } from "./settings/SettingTab";
import { OutputService, type OutputAction } from "./output/OutputService";
import type { OutputRequest, OutputScope } from "./output/build";
import type { Derived } from "./ui/state";
import type { ZoteroItem } from "./model/types";
import { renderReport, runVerification, type FsLike, type SessionInfo } from "./verify/verify";
import { createNodeFs } from "./verify/nodeFs";

const REPORT_NOTE = "Zotero Library — informe de verificación.md";

const TRANSPORTS: Transport[] = [
  { name: "requestUrl de Obsidian", http: obsidianHttp },
  { name: "Node http", http: nodeHttp },
];

const nodeFs: FsLike = createNodeFs((p) => fsp.access(p), (p) => fsp.readdir(p));

export default class ZoteroLibraryPlugin extends Plugin {
  settings!: ZoteroLibrarySettings;
  /** Índice en memoria; null hasta que se carga la biblioteca */
  index: LibraryIndex | null = null;
  private loadMs = 0;
  /** Cómo se cargó la biblioteca en esta sesión y la última sincronización (para el informe) */
  private session: SessionInfo = {};
  /** Datos de la copia en disco con la que se abrió (si se usó) */
  cacheInfo: { savedAt: number; ms: number } | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign(defaultSettings(), await this.loadData());
    const adapter = this.app.vault.adapter as { getBasePath?: () => string } | undefined;
    trace.init(typeof adapter?.getBasePath === "function" ? adapter.getBasePath() : null, this.manifest.dir, this.manifest.version);
    trace.log("onload: ajustes cargados");
    this.installWatchdog();
    this.addSettingTab(new ZoteroLibrarySettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => {
      trace.log("Obsidian pide crear la vista");
      try {
        return new ZoteroLibraryView(leaf, this);
      } catch (e) {
        trace.error("el constructor de la vista", e);
        throw e;
      }
    });
    this.addRibbonIcon("library", "Abrir Zotero Library", () => void this.activateView());
    this.addCommand({
      id: "open-view",
      name: "Abrir Zotero Library",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "reset-view",
      name: "Reiniciar la vista de Zotero Library (si se queda en negro)",
      callback: () => void this.activateView(true),
    });
    this.addCommand({
      id: "show-log",
      name: "Mostrar el registro de diagnóstico de Zotero Library",
      callback: () => new ReportModal(this.app, `Archivo: ${trace.file ?? "(sin registro en disco)"}\n\n${trace.tail(300)}`, null, "Registro de Zotero Library").open(),
    });

    this.addCommand({
      id: "test-connection",
      name: "Probar conexión con Zotero",
      callback: () => void this.testConnection(),
    });
    this.addCommand({
      id: "diagnose-connection",
      name: "Diagnosticar la conexión con Zotero",
      callback: () => void this.diagnose(),
    });
    this.addCommand({
      id: "load-library",
      name: "Cargar la biblioteca de Zotero",
      callback: () => void this.loadLibrary(true),
    });
    this.addCommand({
      id: "search-preview",
      name: "Buscar ítems (prueba de la búsqueda rápida)",
      callback: () => void this.openSearchPreview(),
    });
    this.addCommand({
      id: "compare-template",
      name: "Comparar plantilla con una nota existente",
      callback: () => void this.openCompare(),
    });
    this.addCommand({
      id: "create-default-template-note",
      name: "Crear una nota desde una plantilla por defecto",
      callback: () => this.pickDefaultTemplate(),
    });
    this.addCommand({
      id: "explore-data",
      name: "Explorar los datos de un ítem (variables para plantillas)",
      callback: () => void this.pickItemToExplore(),
    });
    this.addCommand({
      id: "verification-report",
      name: "Informe de verificación",
      callback: () => void this.openReport(),
    });
  }

  getIndex(): LibraryIndex | null {
    return this.index;
  }

  private output = new OutputService(this);

  runOutput(action: OutputAction, request: OutputRequest, scope: OutputScope, d: Derived): Promise<string> {
    return this.output.run(action, request, scope, d);
  }

  get version(): string {
    return this.manifest.version;
  }

  /** Vigila el hilo principal: si algo lo bloquea, queda anotado cuánto. */
  private installWatchdog(): void {
    if (typeof window === "undefined") return;
    const dog = createWatchdog({ periodMs: 1000, thresholdMs: 1500, isHidden: () => document.visibilityState === "hidden", log: (m) => trace.log(m) });
    this.registerInterval(window.setInterval(() => dog.tick(), 1000));
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "hidden") dog.markHidden();
    });
    this.registerDomEvent(window, "error", (e: ErrorEvent) => trace.log(`error de la ventana: ${e.message} (${e.filename}:${e.lineno})`));
    this.registerDomEvent(window, "unhandledrejection", (e: PromiseRejectionEvent) => trace.log(`promesa rechazada sin tratar: ${(e.reason as Error)?.stack ?? e.reason}`));
  }

  /**
   * Abre la vista principal. Si ya hay una sana, la trae al frente; si hay una
   * rota o a medio cargar (pestaña en negro), la cierra y crea otra. Con
   * `force`, siempre empieza de nuevo.
   */
  async activateView(force = false): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    const states = leaves.map((l) => (l.view instanceof ZoteroLibraryView ? l.view.health() : "sin-vista"));
    trace.log(`activateView: ${leaves.length} pestaña(s) existentes [${states.join(", ")}], force=${force}`);
    const healthy = force ? undefined : leaves.find((l) => l.view instanceof ZoteroLibraryView && l.view.health() !== "failed");
    if (healthy) {
      void this.app.workspace.revealLeaf(healthy);
      return;
    }
    for (const l of leaves) l.detach();
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
    trace.log("activateView: pestaña creada");
  }

  /** Lo que el menú de un ítem necesita del sistema: enlaces de Zotero y archivos locales (Electron, solo escritorio). */
  private openDeps(): OpenDeps {
    const shell = (): { openPath(p: string): Promise<string>; showItemInFolder(p: string): void } | null => {
      try {
        return ((window as unknown as { require?: (m: string) => { shell?: never } }).require?.("electron")?.shell ?? null) as never;
      } catch {
        return null;
      }
    };
    return {
      openUrl: (url) => void window.open(url),
      openPath: (path) => {
        const sh = shell();
        if (!sh) return void new Notice("Abrir archivos locales solo funciona en la versión de escritorio.");
        void sh.openPath(path).then((err) => err && new Notice(`No se pudo abrir el archivo: ${err}`, 8000));
      },
      showInFolder: (path) => {
        const sh = shell();
        if (!sh) return void new Notice("Mostrar archivos locales solo funciona en la versión de escritorio.");
        sh.showItemInFolder(path);
      },
    };
  }

  /** Abre un archivo local con el sistema (enlace «Local» de las tarjetas). */
  openLocalFile(path: string): void {
    this.openDeps().openPath(path);
  }

  /** Clic derecho sobre un ítem de la lista: abrir y encontrar, en Zotero y en local. */
  showItemMenu(item: ZoteroItem, evt: MouseEvent): void {
    if (!this.index) return;
    const platform = typeof process !== "undefined" ? process.platform : "linux";
    const entries = buildItemMenu(attachmentChoices(this.index, item, this.settings.zoteroDataDir), item.key, this.openDeps(), platform);
    const fill = (menu: Menu, list: MenuEntry[]): void => {
      for (const e of list) {
        menu.addItem((mi) => {
          mi.setTitle(e.title);
          if (e.disabled) mi.setDisabled(true);
          if (e.submenu) {
            const sub = (mi as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
            if (sub) fill(sub, e.submenu);
            else
              mi.onClick(() => {
                const second = new Menu();
                fill(second, e.submenu!);
                second.showAtMouseEvent(evt);
              });
          } else if (e.run) {
            mi.onClick(() => e.run!());
          }
        });
      }
    };
    const menu = new Menu();
    fill(menu, entries);
    menu.showAtMouseEvent(evt);
  }

  /** Fecha de la última sincronización correcta; si aún no hay ninguna, la de la copia en disco. */
  lastSyncAt(): number | null {
    return this.settings.lastSyncAt || this.cacheInfo?.savedAt || null;
  }

  private markSynced(): void {
    this.settings.lastSyncAt = Date.now();
    void this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  createSource(): LocalApiSource {
    return new LocalApiSource({
      baseUrl: this.settings.baseUrl,
      libraryPath: this.settings.libraryPath,
      http: withFallback(obsidianHttp, nodeHttp),
    });
  }

  async diagnose(): Promise<void> {
    const d = await diagnoseConnection(TRANSPORTS, this.settings.baseUrl, this.settings.libraryPath);
    new ReportModal(this.app, renderDiagnosis(d), null, "Diagnóstico de conexión").open();
  }

  private reportError(e: unknown): void {
    if (e instanceof ZoteroConnectionError) {
      new Notice(`${e.message}\n${e.hint}\nUsa el comando «Diagnosticar la conexión con Zotero» para más detalle.`, 12000);
    } else {
      new Notice(`Error: ${(e as Error).message}`, 8000);
      console.error("[zotero-library]", e);
    }
  }

  async testConnection(): Promise<void> {
    try {
      const ping = await this.createSource().ping();
      new Notice(`Conectado a Zotero. Entidades: ${ping.total}. Versión de la biblioteca: ${ping.libraryVersion}.`);
    } catch (e) {
      if (e instanceof ZoteroConnectionError && e.status === undefined) {
        // Sin respuesta HTTP: abrir directamente el diagnóstico.
        await this.diagnose();
      } else {
        this.reportError(e);
      }
    }
  }

  /** Carga en curso: si se pide otra mientras tanto, se comparte (Zotero solo atiende de una en una). */
  private loading: Promise<LibraryIndex | null> | null = null;
  private syncing: ReturnType<ZoteroLibraryPlugin["runSync"]> | null = null;

  async loadLibrary(announce: boolean, onProgress?: (loaded: number, total: number) => void): Promise<LibraryIndex | null> {
    if (!this.loading) {
      this.loading = this.runLoad(onProgress).finally(() => (this.loading = null));
    }
    const index = await this.loading;
    if (announce && index) {
      const s = index.stats();
      new Notice(`Biblioteca cargada en ${this.loadMs} ms: ${s.items} ítems, ${s.annotations} anotaciones, ${s.collections} colecciones.`, 8000);
    }
    return index;
  }

  private async runLoad(onProgress?: (loaded: number, total: number) => void): Promise<LibraryIndex | null> {
    const progress = new Notice("Cargando la biblioteca de Zotero…", 0);
    trace.log("loadLibrary: empieza la descarga completa");
    try {
      const t0 = Date.now();
      const raw = await this.createSource().fetchLibrary((loaded, total) => {
        progress.setMessage(`Cargando la biblioteca de Zotero… ${loaded}/${total}`);
        onProgress?.(loaded, total);
      });
      this.index = LibraryIndex.fromRaw(raw);
      this.loadMs = Date.now() - t0;
      this.session = { ...this.session, origin: "download", ms: this.loadMs };
      this.cacheInfo = null;
      this.markSynced();
      void this.saveCache();
      progress.hide();
      trace.log(`loadLibrary: terminada en ${this.loadMs} ms (${raw.entities.length} entidades, ${raw.requests ?? "?"} peticiones)`);
      if (raw.truncated) new Notice("Aviso: llegaron menos entidades de las anunciadas.", 8000);
      return this.index;
    } catch (e) {
      progress.hide();
      trace.error("loadLibrary", e);
      this.reportError(e);
      return null;
    }
  }

  // ----- Copia en disco y sincronización incremental -----

  private cachePath(): string {
    return normalizePath(`${this.manifest.dir ?? ".obsidian/plugins/zotero-library"}/library-cache.json.gz`);
  }

  /** Abre la biblioteca desde la copia en disco (casi instantáneo). */
  async loadFromCache(): Promise<LibraryIndex | null> {
    if (!this.settings.useDiskCache) return null;
    try {
      const adapter = this.app.vault.adapter;
      const path = this.cachePath();
      if (!(await adapter.exists(path))) return null;
      const t0 = Date.now();
      trace.log("loadFromCache: leyendo la copia");
      const bytes = await adapter.readBinary(path);
      trace.log(`loadFromCache: leída (${(bytes.byteLength / 1e6).toFixed(1)} MB comprimidos) en ${Date.now() - t0} ms`);
      const packed = await unpackCache(bytes);
      trace.log(`loadFromCache: descomprimida en ${Date.now() - t0} ms${packed ? "" : " (copia inválida)"}`);
      if (!packed || packed.meta.libraryPath !== this.settings.libraryPath) return null;
      this.index = LibraryIndex.fromRaw(packed.raw);
      this.cacheInfo = { savedAt: packed.meta.savedAt, ms: Date.now() - t0 };
      this.session = { ...this.session, origin: "cache", ms: this.cacheInfo.ms, cacheSavedAt: packed.meta.savedAt };
      trace.log(`loadFromCache: índice listo en ${this.cacheInfo.ms} ms`);
      return this.index;
    } catch (e) {
      trace.error("loadFromCache", e);
      return null;
    }
  }

  async saveCache(): Promise<void> {
    if (!this.settings.useDiskCache || !this.index) return;
    try {
      const t0 = Date.now();
      trace.log("saveCache: empieza");
      const data = await packCache(this.index.toRaw(), { savedAt: Date.now(), libraryPath: this.settings.libraryPath, plugin: this.manifest.version });
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      await this.app.vault.adapter.writeBinary(this.cachePath(), buffer);
      trace.log(`saveCache: guardada (${(buffer.byteLength / 1e6).toFixed(1)} MB) en ${Date.now() - t0} ms`);
    } catch (e) {
      trace.error("saveCache", e);
    }
  }

  async clearCache(): Promise<boolean> {
    const adapter = this.app.vault.adapter;
    const path = this.cachePath();
    if (!(await adapter.exists(path))) return false;
    await adapter.remove(path);
    return true;
  }

  /**
   * Pone la biblioteca al día. Si la versión no cambió, no hace nada; si cambió,
   * pide solo lo modificado (y lo eliminado) y, si la API no lo permite, recarga todo.
   */
  syncLibrary(): ReturnType<ZoteroLibraryPlugin["runSync"]> {
    if (!this.syncing) this.syncing = this.runSync().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async runSync(): Promise<{ status: "unchanged" | "incremental" | "full" | "offline" | "failed"; index: LibraryIndex | null; message?: string; ms: number }> {
    const t0 = Date.now();
    const done = (status: "unchanged" | "incremental" | "full" | "offline" | "failed", message?: string) => {
      trace.log(`syncLibrary: ${status} en ${Date.now() - t0} ms${message ? ` (${message})` : ""}`);
      this.session = { ...this.session, lastSync: { status, ms: Date.now() - t0, at: Date.now() } };
      return { status, index: this.index, message, ms: Date.now() - t0 };
    };
    const source = this.createSource();
    let version: number;
    try {
      version = (await source.ping()).libraryVersion;
    } catch (e) {
      return done("offline", (e as Error).message);
    }
    if (this.index && version === this.index.libraryVersion) {
      this.markSynced();
      return done("unchanged");
    }

    try {
      let raw: RawLibrary | null = null;
      let status: "incremental" | "full" = "full";
      if (this.index) {
        try {
          const current = this.index.toRaw();
          const changes = await source.fetchChanges(this.index.libraryVersion, {
            items: new Set(current.entities.map((e) => e.key)),
            collections: new Set(current.collections.map((c) => c.key)),
          });
          if (changes.deleted) {
            raw = mergeChanges(current, changes, version);
            status = "incremental";
          }
        } catch {
          raw = null; // se recarga todo
        }
      }
      if (!raw) raw = await source.fetchLibrary();
      this.index = LibraryIndex.fromRaw(raw);
      this.cacheInfo = null;
      this.markSynced();
      void this.saveCache();
      return done(status);
    } catch (e) {
      return done("failed", (e as Error).message);
    }
  }

  /** Rutas relativas de las plantillas de la carpeta configurada. */
  templatePaths(): string[] {
    return listTemplates(this.app.vault.getFiles().map((f) => f.path), this.settings.templatesFolder);
  }

  /** Crea el motor con las plantillas actuales de la carpeta (para {% include %}). */
  /** Último motor creado: se reutiliza mientras no cambien las plantillas (así no se recompilan en cada dibujado). */
  private engineCache: { signature: string; engine: TemplateEngine; templates: Map<string, string> } | null = null;

  async createEngine(): Promise<{ engine: TemplateEngine; templates: Map<string, string> }> {
    const folder = this.settings.templatesFolder;
    const files = this.app.vault.getFiles().filter((f) => isTemplatePath(f.path) && relativeToFolder(f.path, folder) !== null);
    const contents = await Promise.all(files.map(async (f) => ({ path: f.path, content: await this.app.vault.cachedRead(f) })));
    const signature = `${folder}\u0000${contents.map((c) => `${c.path}\u0001${c.content}`).join("\u0000")}`;
    if (this.engineCache?.signature === signature) return { engine: this.engineCache.engine, templates: this.engineCache.templates };
    const templates = buildTemplateMap(contents, folder);
    const engine = new TemplateEngine({ moment: moment as unknown as MomentFn, templates });
    this.engineCache = { signature, engine, templates };
    return { engine, templates };
  }

  contextOptions(engine: TemplateEngine): ContextOptions {
    return {
      dataDir: this.settings.zoteroDataDir,
      imagesFolder: this.settings.imagesFolder,
      imageNameTemplate: this.settings.imageNameTemplate,
      renderString: (t, c) => engine.render(t, c),
    };
  }

  async renderItemTemplate(templatePath: string, itemKey: string): Promise<string> {
    const index = this.index ?? (await this.loadLibrary(false));
    if (!index) throw new Error("No se pudo cargar la biblioteca de Zotero.");
    const item = index.items.get(itemKey);
    if (!item) throw new Error(`No hay ningún ítem con la clave ${itemKey}. ¿Es la clave del ítem y no la del adjunto?`);
    const { engine, templates } = await this.createEngine();
    const source = templates.get(templatePath);
    if (source === undefined) throw new Error(`No encuentro la plantilla «${templatePath}» en «${this.settings.templatesFolder}».`);
    const all = index.annotationsOf(itemKey);
    return engine.render(source, itemContext(index, item, all, all, this.contextOptions(engine)), templatePath);
  }

  /** Elige una plantilla por defecto y la vuelca a una nota de la raíz de la bóveda. */
  pickDefaultTemplate(): void {
    new DefaultTemplatePicker(this.app, (entry) => void this.createDefaultTemplateNote(entry)).open();
  }

  /**
   * Crea en la raíz de la bóveda una nota con el contenido de una plantilla por defecto, para editarla.
   * No cambia la opción «por defecto» ni vigila la nota después: si la mueves a la carpeta de plantillas, la eliges en los ajustes.
   */
  async createDefaultTemplateNote(entry: DefaultTemplateEntry): Promise<void> {
    const path = normalizePath(entry.fileName);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const write = async (): Promise<void> => {
      try {
        let file: TFile;
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, entry.source);
          file = existing;
        } else {
          file = await this.app.vault.create(path, entry.source);
        }
        await this.app.workspace.getLeaf(true).openFile(file);
        new Notice(`${existing instanceof TFile ? "Nota reemplazada" : "Nota creada"} en la raíz: «${path}». Para usarla, muévela a «${this.settings.templatesFolder}» y elígela en los ajustes o en los paneles.`, 9000);
      } catch (e) {
        trace.error("createDefaultTemplateNote", e);
        new Notice(`No se pudo crear la nota: ${(e as Error).message}`, 8000);
      }
    };
    if (existing && !(existing instanceof TFile)) {
      new Notice(`«${path}» existe y no es una nota; cámbiale el nombre o muévela.`, 8000);
      return;
    }
    if (existing instanceof TFile) new ConfirmReplaceModal(this.app, path, () => void write()).open();
    else await write();
  }

  /** Datos de la biblioteca para el explorador: los mismos contextos que reciben las plantillas. */
  private async explorerSource(index: LibraryIndex): Promise<ExplorerSource> {
    const { engine } = await this.createEngine();
    const opts = this.contextOptions(engine);
    return {
      itemLabel: (k) => {
        const it = index.entry(k);
        return it ? itemLabel(it) : k;
      },
      itemContext: (k) => {
        const it = index.entry(k);
        if (!it) return null;
        const all = index.annotationsOf(k);
        return itemContext(index, it, all, all, opts);
      },
      libraryItems: () => [...index.items.values(), ...index.attachmentItems.values()].map((i) => ({ key: i.key, label: itemLabel(i) })),
      itemKeyOfAnnotation: (k) => {
        const a = index.annotations.get(k);
        return a ? index.itemKeyOf(a) : null;
      },
    };
  }

  /** Abre el explorador de datos; copia `{{ variable }}` al portapapeles con cada clic. */
  async openExplorer(start: ExplorerStart): Promise<void> {
    const index = this.index ?? (await this.loadLibrary(false));
    if (!index) {
      new Notice("No se pudo cargar la biblioteca de Zotero.", 6000);
      return;
    }
    const source = await this.explorerSource(index);
    const copy = (text: string, what: CopyKind) => {
      if (!text) {
        new Notice("Ese valor está vacío: no hay nada que copiar.", 2500);
        return;
      }
      const shown = text.replace(/\s+/g, " ").trim();
      const label = `${what === "valor" ? "Valor copiado" : "Variable copiada"}: ${shown.length > 80 ? `${shown.slice(0, 79)}…` : shown}`;
      void navigator.clipboard.writeText(text).then(
        () => new Notice(label, 2500),
        () => new Notice("No se pudo copiar al portapapeles.", 4000),
      );
    };
    new DataExplorerModal(this.app, source, copy, start).open();
  }

  /** Comando: elegir un ítem de la biblioteca y explorar sus datos. */
  async pickItemToExplore(): Promise<void> {
    const index = this.index ?? (await this.loadLibrary(false));
    if (!index) {
      new Notice("No se pudo cargar la biblioteca de Zotero.", 6000);
      return;
    }
    const choices = [...index.items.values(), ...index.attachmentItems.values()].map((i) => ({ key: i.key, label: itemLabel(i) }));
    new ItemPickerModal(this.app, choices, (key) => void this.openExplorer({ kind: "item", key })).open();
  }

  async openCompare(): Promise<void> {
    if (!this.index) await this.loadLibrary(false);
    const settings = this.settings;
    new CompareModal(this.app, {
      templates: () => this.templatePaths(),
      // getActiveFile devuelve la nota activa o, si la vista no es una nota, la última abierta
      activeNotePath: () => this.app.workspace.getActiveFile()?.path ?? this.app.workspace.getLastOpenFiles()[0] ?? null,
      loadState: () => ({ template: settings.compareTemplate, itemKey: settings.compareItemKey, notePath: settings.compareNotePath }),
      saveState: async (st) => {
        settings.compareTemplate = st.template;
        settings.compareItemKey = st.itemKey;
        settings.compareNotePath = st.notePath;
        await this.saveSettings();
      },
      renderItemTemplate: (t, k) => this.renderItemTemplate(t, k),
      readNote: async (path) => {
        const f = this.app.vault.getAbstractFileByPath(path) ?? this.app.vault.getAbstractFileByPath(`${path}.md`);
        return f instanceof TFile ? this.app.vault.cachedRead(f) : null;
      },
      describeAnnotations: (keys) =>
        keys.map((k) => {
          const a = this.index?.annotations.get(k);
          return a ? `${k}: sortIndex ${a.sortIndex || "(vacío)"} · alta ${a.dateAdded} · página ${a.pageLabel || "?"}` : `${k}: no está en la biblioteca cargada`;
        }),
    }).open();
  }

  async openSearchPreview(): Promise<void> {
    const index = this.index ?? (await this.loadLibrary(false));
    if (index) new SearchPreviewModal(this.app, index).open();
  }

  async openReport(): Promise<void> {
    const index = this.index ?? (await this.loadLibrary(false));
    if (!index) return;
    try {
      const checks = await runVerification({
        source: this.createSource(),
        index,
        fs: nodeFs,
        dataDir: this.settings.zoteroDataDir,
        session: this.session,
      });
      const markdown = renderReport(checks, {
        date: new Date().toISOString(),
        pluginVersion: this.manifest.version,
      });
      new ReportModal(this.app, markdown, () => this.saveReportNote(markdown)).open();
    } catch (e) {
      this.reportError(e);
    }
  }

  private async saveReportNote(markdown: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(REPORT_NOTE);
    if (existing instanceof TFile) await this.app.vault.modify(existing, markdown);
    else await this.app.vault.create(REPORT_NOTE, markdown);
    new Notice(`Informe guardado en «${REPORT_NOTE}»`);
  }
}

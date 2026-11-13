import { promises as fsp } from "fs";
import { TFile, normalizePath, type App, type MarkdownView } from "obsidian";
import type { LibraryIndex } from "../index/LibraryIndex";
import { trace } from "../log";
import type { ZoteroLibrarySettings } from "../settings";
import type { ContextOptions } from "../template/context";
import type { TemplateEngine } from "../template/engine";
import type { Derived } from "../ui/state";
import { buildOutput, type BuiltOutput, type OutputRequest, type OutputScope } from "./build";
import { noteBaseName, uniqueNotePath } from "./noteName";
import { copyImages, describeImages, type ImageIO } from "./images";
import type { LocalApiSource } from "../source/LocalApiSource";
import { writeClipboardText } from "../clipboard";

export type OutputAction = "copy" | "insert" | "note";

/** Lo que el servicio necesita del plugin. */
export interface OutputHost {
  app: App;
  settings: ZoteroLibrarySettings;
  getIndex(): LibraryIndex | null;
  createEngine(): Promise<{ engine: TemplateEngine; templates: Map<string, string> }>;
  contextOptions(engine: TemplateEngine): ContextOptions;
  createSource(): LocalApiSource;
}

const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;

function isEditableMarkdownView(view: unknown, path: string): view is Pick<MarkdownView, "file" | "editor"> {
  if (!view || typeof view !== "object") return false;
  const file = Reflect.get(view, "file");
  const editor = Reflect.get(view, "editor");
  return !!file && typeof file === "object" && Reflect.get(file, "path") === path
    && !!editor && typeof editor === "object" && typeof Reflect.get(editor, "replaceSelection") === "function";
}

/** Copiar al portapapeles, insertar en la nota activa o crear una nota nueva con el resultado. */
export class OutputService {
  constructor(private readonly host: OutputHost) {}

  async run(action: OutputAction, request: OutputRequest, scope: OutputScope, d: Derived): Promise<string> {
    const { host } = this;
    const index = host.getIndex();
    if (!index) throw new Error("La biblioteca todavía no está cargada.");
    if (!d.selectedItems.length) throw new Error("Selecciona uno o más ítems para sacar su contenido.");
    const s = host.settings;

    const { engine, templates } = await host.createEngine();
    const built = await buildOutput(d, request, scope, {
      index,
      engine,
      templates,
      opts: host.contextOptions(engine),
      settings: {
        defaultTemplates: { full: s.defaultPrintFull, meta: s.defaultPrintMeta, annotations: s.defaultPrintAnnotations, bibliography: s.defaultPrintBibliography, link: s.defaultPrintLink },
        defaultStyle: s.bibliographyStyle,
        stripFrontmatterMulti: s.stripFrontmatterMulti,
        groupHeaders: s.groupHeaders,
      },
      fetchBibliography: async (keys, style) => {
        const r = await host.createSource().fetchBibliography(keys, style);
        return { entries: r.entries, failed: r.failed };
      },
    });
    if (!built.text.trim()) throw new Error("La plantilla no produjo ningún texto.");

    const notes = [...built.warnings];
    if (s.copyImagesOnOutput && built.images.length) {
      const copied = await copyImages(built.images, this.imageIO(), s.imagesFolder, s.zoteroDataDir);
      notes.push(...describeImages(copied));
      if (copied.missingKeys.length) trace.log(`imágenes sin PNG en la caché de Zotero (${copied.missingKeys.length}): ${copied.missingKeys.join(", ")}`);
    }

    let done: string;
    if (action === "copy") {
      await writeClipboardText(built.text);
      done = "Copiado";
    } else if (action === "insert") {
      done = `Insertado en «${await this.insertIntoActiveNote(built.text)}»`;
    } else {
      done = `Nota creada: «${await this.createNote(built, engine)}»`;
    }

    const what = [`${built.items} ítem(s)`, ...(built.annotations ? [`${built.annotations} anotación(es)`] : [])].join(" · ");
    return [`${done}: ${what}`, ...notes].join(" · ");
  }

  /** Inserta en el cursor si la nota está abierta en un editor; si no, al final del archivo. */
  private async insertIntoActiveNote(text: string): Promise<string> {
    const { app } = this.host;
    const file = app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error("No hay ninguna nota abierta donde insertar. Abre una nota o usa «Nueva nota».");
    }
    const leaf = app.workspace.getLeavesOfType("markdown").find((l) => isEditableMarkdownView(l.view, file.path));
    const editor = leaf && isEditableMarkdownView(leaf.view, file.path) ? leaf.view.editor : undefined;
    if (editor) editor.replaceSelection(text);
    else await app.vault.append(file, `\n${text}`);
    return file.path;
  }

  private async createNote(built: BuiltOutput, engine: TemplateEngine): Promise<string> {
    const { app, settings } = this.host;
    const folder = normalizePath(settings.newNoteFolder.trim() || "/");
    if (folder !== "/") await this.ensureFolder(folder);
    const dir = folder === "/" ? "" : `${folder}/`;
    // El nombre sale de la plantilla de ítems o de anotaciones; si ya existe se le añade la clave de Zotero
    const base = noteBaseName(engine, {
      template: built.entity === "annotation" ? settings.noteNameAnnotation : settings.noteNameItem,
      context: built.single,
      stamp: stamp(),
      count: built.entity === "annotation" ? built.annotations : built.items,
    });
    const path = normalizePath(await uniqueNotePath(dir, base, built.singleKey, (p) => app.vault.adapter.exists(normalizePath(p))));
    const file = await app.vault.create(path, built.text);
    if (settings.openNewNote) await app.workspace.getLeaf(true).openFile(file);
    return path;
  }

  private async ensureFolder(path: string): Promise<void> {
    const { vault } = this.host.app;
    let current = "";
    for (const part of normalizePath(path).split("/")) {
      current = current ? `${current}/${part}` : part;
      if (!(await vault.adapter.exists(current))) await vault.createFolder(current).catch(() => undefined);
    }
  }

  private imageIO(): ImageIO {
    const { vault } = this.host.app;
    return {
      vaultExists: (p) => vault.adapter.exists(normalizePath(p)),
      diskExists: (p) => fsp.access(p).then(() => true, () => false),
      realpath: (p) => fsp.realpath(p),
      readDisk: async (p) => {
        const b = await fsp.readFile(p);
        return Uint8Array.from(b).buffer;
      },
      ensureFolder: (p) => this.ensureFolder(p),
      writeVault: async (p, data) => void (await vault.createBinary(normalizePath(p), data)),
    };
  }
}

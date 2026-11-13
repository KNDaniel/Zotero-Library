import type { LibraryIndex } from "../index/LibraryIndex";
import type { ZoteroItem } from "../model/types";
import { attachmentFilePath } from "../template/context";
import { zoteroOpenFirstPageUri, zoteroOpenUri, zoteroSelectUri } from "../template/links";

/** Un adjunto que se puede abrir desde el menú de un ítem. */
export interface AttachmentChoice {
  key: string;
  name: string;
  /** Ruta absoluta del archivo local; null si no tiene (enlaces a URL, etc.) */
  path: string | null;
  /** Es un PDF: «Abrir en Zotero» lo abre en la primera página */
  pdf: boolean;
}

/** Lo que el menú necesita del sistema; en pruebas se sustituye. */
export interface OpenDeps {
  openUrl(url: string): void;
  openPath(path: string): void;
  showInFolder(path: string): void;
}

export interface MenuEntry {
  title: string;
  disabled?: boolean;
  run?: () => void;
  /** Entradas anidadas (varios adjuntos) */
  submenu?: MenuEntry[];
}

export { zoteroOpenUri };

/** Ruta con las barras propias del sistema (en Windows, invertidas). */
export function toNativePath(path: string, platform: string): string {
  return platform === "win32" ? path.replace(/\//g, "\\") : path;
}

const isPdf = (contentType: string): boolean => /pdf/i.test(contentType);

/** Adjuntos de un ítem: PDF primero y luego el resto en el orden de Zotero. Un adjunto sin contenedor es su propio adjunto. */
export function attachmentChoices(index: LibraryIndex, item: ZoteroItem, dataDir: string): AttachmentChoice[] {
  const list = index.attachmentsOf(item.key);
  const ordered = [...list.filter((a) => isPdf(a.contentType)), ...list.filter((a) => !isPdf(a.contentType))];
  return ordered.map((a) => ({ key: a.key, name: a.filename || a.title || a.key, path: attachmentFilePath(a, dataDir), pdf: isPdf(a.contentType) }));
}

/**
 * Entradas del menú contextual de un ítem:
 *  Abrir en Zotero · Encontrar en Zotero · Abrir local · Encontrar local.
 * Con varios adjuntos, «Abrir…» lleva un submenú con sus nombres; sin archivo local, lo local queda desactivado.
 */
export function buildItemMenu(choices: AttachmentChoice[], itemKey: string, deps: OpenDeps, platform = "linux"): MenuEntry[] {
  const forEach = (title: string, pool: AttachmentChoice[], run: (a: AttachmentChoice) => void): MenuEntry => {
    if (pool.length === 0) return { title, disabled: true };
    if (pool.length === 1) return { title, run: () => run(pool[0]!) };
    return { title, submenu: pool.map((a) => ({ title: a.name, run: () => run(a) })) };
  };
  const local = choices.filter((a) => a.path);
  return [
    forEach("Abrir en Zotero", choices, (a) => deps.openUrl(zoteroOpenFirstPageUri(a.key, a.pdf))),
    { title: "Encontrar en Zotero", run: () => deps.openUrl(zoteroSelectUri(itemKey)) },
    forEach("Abrir local", local, (a) => deps.openPath(toNativePath(a.path!, platform))),
    forEach("Encontrar local", local, (a) => deps.showInFolder(toNativePath(a.path!, platform))),
  ];
}

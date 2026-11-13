import type { PreviewImage } from "../markdown";
import { isImagePathInsideFolder } from "../vaultPaths";
import { isZoteroLibraryCacheImagePath } from "../zoteroImagePaths";

/** Operaciones de disco y vault que necesita la copia de imágenes (inyectables para probar). */
export interface ImageIO {
  vaultExists(path: string): Promise<boolean>;
  diskExists(path: string): Promise<boolean>;
  realpath(path: string): Promise<string>;
  readDisk(path: string): Promise<ArrayBuffer>;
  ensureFolder(path: string): Promise<void>;
  writeVault(path: string, data: ArrayBuffer): Promise<void>;
}

export interface ImageCopyResult {
  copied: string[];
  /** Ya estaban en el vault: no se tocan */
  existing: string[];
  /** La imagen no está en la caché de Zotero */
  missing: string[];
  /** Claves de Zotero de las anotaciones cuya imagen falta (para saber cuáles abrir en Zotero) */
  missingKeys: string[];
  failed: Array<{ path: string; error: string }>;
}

/** Cuántas claves se nombran en el aviso (la lista completa va al registro) */
const MAX_KEYS_SHOWN = 5;

const folderOf = (p: string) => p.split("/").slice(0, -1).join("/");

/**
 * Copia de la caché de Zotero al vault las imágenes que la salida referencia.
 * Los nombres son deterministas: si el archivo ya existe se reutiliza.
 */
export async function copyImages(images: PreviewImage[], io: ImageIO, imagesFolder: string, zoteroDataDir: string): Promise<ImageCopyResult> {
  const result: ImageCopyResult = { copied: [], existing: [], missing: [], missingKeys: [], failed: [] };
  const seen = new Set<string>();
  for (const img of images) {
    if (!img.relativePath || seen.has(img.relativePath)) continue;
    seen.add(img.relativePath);
    try {
      if (!isImagePathInsideFolder(img.relativePath, imagesFolder)) throw new Error("La ruta de destino no es un PNG directo dentro de la carpeta de imágenes.");
      if (await io.vaultExists(img.relativePath)) {
        result.existing.push(img.relativePath);
        continue;
      }
      if (!isZoteroLibraryCacheImagePath(img.absolutePath, zoteroDataDir)) throw new Error("La ruta de origen de imagen no pertenece a cache/library de Zotero.");
      if (!(await io.diskExists(img.absolutePath))) {
        result.missing.push(img.relativePath);
        if (img.key) result.missingKeys.push(img.key);
        continue;
      }
      const realSource = await io.realpath(img.absolutePath);
      if (!isZoteroLibraryCacheImagePath(realSource, zoteroDataDir)) throw new Error("La ruta de origen de imagen no pertenece a cache/library de Zotero.");
      const folder = folderOf(img.relativePath);
      if (folder) await io.ensureFolder(folder);
      await io.writeVault(img.relativePath, await io.readDisk(realSource));
      result.copied.push(img.relativePath);
    } catch (e) {
      result.failed.push({ path: img.relativePath, error: (e as Error).message });
    }
  }
  return result;
}

export function describeImages(r: ImageCopyResult): string[] {
  const out: string[] = [];
  if (r.copied.length) out.push(`${r.copied.length} imagen(es) copiada(s) al vault`);
  if (r.missing.length) {
    // Con las claves de las anotaciones: Zotero genera el PNG al abrir la anotación en su lector
    const shown = r.missingKeys.slice(0, MAX_KEYS_SHOWN).join(", ");
    const more = r.missingKeys.length - MAX_KEYS_SHOWN;
    const keys = r.missingKeys.length ? ` (anotaciones: ${shown}${more > 0 ? ` y ${more} más` : ""})` : "";
    out.push(`${r.missing.length} imagen(es) no encontrada(s) en la caché de Zotero${keys}`);
  }
  if (r.failed.length) out.push(`${r.failed.length} imagen(es) con error al copiar`);
  return out;
}

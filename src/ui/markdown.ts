import type { PreviewImage } from "../markdown";

export type { PreviewImage } from "../markdown";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** URL de archivo para una ruta absoluta (Windows o Unix). */
export function toFileUrl(absolutePath: string): string {
  const p = absolutePath.replace(/\\/g, "/");
  return `file://${p.startsWith("/") ? "" : "/"}${encodeURI(p)}`;
}

/**
 * En la vista previa las imágenes aún no están en el vault (se copian al
 * imprimir), así que los embeds `![[ruta|ancho]]` se sustituyen por la imagen de
 * la caché de Zotero.
 */
export function previewImages(md: string, images: PreviewImage[]): string {
  let out = md;
  for (const img of images) {
    if (!img.relativePath) continue;
    const re = new RegExp(`!\\[\\[${escapeRegExp(img.relativePath)}(?:\\|(\\d+))?\\]\\]`, "g");
    out = out.replace(re, (_m, width?: string) => `<img src="${toFileUrl(img.absolutePath)}"${width ? ` width="${width}"` : ""} alt="Imagen de anotación de Zotero">`);
  }
  return out;
}

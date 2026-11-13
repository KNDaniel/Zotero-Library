/** Quita el bloque YAML inicial de una plantilla que genera una nota completa. */
export function stripFrontmatter(md: string): string {
  const m = /^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
  return m ? md.slice(m[0].length) : md;
}

/** Referencia a una imagen de anotación usada en la salida Markdown. */
export interface PreviewImage {
  /** Ruta que la plantilla escribe en el vault, relativa a la bóveda */
  relativePath: string;
  /** Archivo real en la caché de Zotero */
  absolutePath: string;
  /** Clave de Zotero de la anotación de imagen (para avisar de cuáles faltan) */
  key?: string;
}

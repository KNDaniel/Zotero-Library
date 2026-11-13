/** Enlaces que las plantillas de Zotero Integration esperan encontrar ya construidos. */

export const zoteroSelectUri = (key: string, library = "library"): string => `zotero://select/${library}/items/${key}`;

/** Abre el adjunto en Zotero (`open`): funciona con PDF y con cualquier otro adjunto. */
export const zoteroOpenUri = (attachmentKey: string, library = "library"): string => `zotero://open/${library}/items/${attachmentKey}`;

/**
 * Abre el adjunto en la primera página cuando es un PDF (`?page=1`); con otros adjuntos (capturas, Word…) no hay páginas
 * y el enlace es el de siempre.
 */
export const zoteroOpenFirstPageUri = (attachmentKey: string, isPdf: boolean, library = "library"): string =>
  isPdf ? `${zoteroOpenUri(attachmentKey, library)}?page=1` : zoteroOpenUri(attachmentKey, library);

/**
 * Abre el adjunto en la anotación (siempre `open`, nunca `open-pdf`). `page` es la etiqueta de página, como hace
 * Zotero Integration; las anotaciones sin página (capturas web, EPUB) llevan solo `?annotation=<clave>`.
 */
export const openAnnotationUri = (attachmentKey: string, pageLabel: string | undefined, annotationKey: string, library = "library"): string =>
  pageLabel ? `${zoteroOpenUri(attachmentKey, library)}?page=${pageLabel}&annotation=${annotationKey}` : `${zoteroOpenUri(attachmentKey, library)}?annotation=${annotationKey}`;

/**
 * Ruta local como URL de archivo: solo se codifican los espacios (%20); los
 * acentos, la «º» o la raya se dejan tal cual, igual que en tu nota de referencia.
 */
export function fileUri(absolutePath: string): string {
  return `file://${absolutePath.replace(/\\/g, "/").replace(/ /g, "%20")}`;
}

/**
 * Enlace de archivo seguro para Markdown: codifica todo lo que rompe un enlace (espacios, paréntesis, corchetes, «#», «%»,
 * acentos…) y escribe las rutas de Windows como `file:///C:/…`. Es el de los botones «Local»; `fileUri` conserva el formato
 * de Zotero Integration para sus plantillas.
 */
export function localFileLink(absolutePath: string): string {
  const parts = absolutePath.replace(/\\/g, "/").split("/");
  const encoded = parts.map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))).join("/");
  return encoded.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

/** La ruta del sistema de un enlace `file://` (lo contrario de `localFileLink` y de `fileUri`); null si no es un enlace de archivo. */
export function fileLinkToPath(href: string, platform = "linux"): string | null {
  if (!/^file:/i.test(href)) return null;
  let path = href.replace(/^file:(\/\/)?/i, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    /* ruta con un «%» suelto: se usa tal cual */
  }
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1); // /C:/… → C:/…
  else if (platform !== "win32" && !path.startsWith("/")) path = `/${path}`;
  return platform === "win32" ? path.replace(/\//g, "\\") : path;
}

export const markdownLink = (label: string, url: string): string => `[${label}](${url})`;

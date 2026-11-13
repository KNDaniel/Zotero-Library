import type { ZoteroAttachment, ZoteroItem } from "./types";

/** Nombre con el que se muestra un adjunto sin contenedor. */
export const attachmentName = (a: ZoteroAttachment): string => a.filename || a.title || a.key;

/**
 * Un adjunto sin contenedor (PDF suelto o con el ítem padre ausente) se maneja
 * como un ítem sintético: así se puede listar, buscar, seleccionar y sacar con
 * las mismas plantillas. Su clave es la del adjunto; no tiene autores ni año.
 */
export function attachmentAsItem(a: ZoteroAttachment): ZoteroItem {
  const title = attachmentName(a);
  return {
    kind: "item",
    key: a.key,
    version: a.version,
    fields: { ...a.fields, title },
    tags: a.tags,
    collections: a.collections,
    relations: a.relations,
    dateAdded: a.dateAdded,
    dateModified: a.dateModified,
    raw: a.raw,
    itemType: "attachment",
    title,
    creators: [],
    attachmentKeys: [a.key],
    noteKeys: [],
    fromAttachment: true,
  };
}

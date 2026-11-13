import { itemTypeLabel } from "../model/itemTypes";
import type { LibraryIndex } from "../index/LibraryIndex";
import { DEFAULT_IMAGE_NAME_STRATEGY, imageParts, type ImageNameStrategy } from "../model/imageName";
import { relatedItemKeys } from "../model/normalize";
import type { ZoteroAnnotation, ZoteroAttachment, ZoteroCreator, ZoteroItem } from "../model/types";
import { imageRelativePath as makeImageRelativePath } from "../vaultPaths";
import { isZoteroKey } from "../zoteroImagePaths";
import { fileUri, localFileLink, markdownLink, openAnnotationUri, zoteroOpenFirstPageUri, zoteroSelectUri } from "./links";

export interface ContextOptions {
  /** Carpeta de datos de Zotero (contiene storage/ y cache/) */
  dataDir: string;
  /** Carpeta del vault donde se guardan las imágenes de anotaciones */
  imagesFolder: string;
  /** Plantilla Nunjucks del nombre de archivo de cada imagen (sin extensión) */
  imageNameTemplate: string;
  /** Renderiza `imageNameTemplate`; lo aporta el motor de plantillas */
  renderString: (template: string, context: object) => string;
  imageStrategy?: ImageNameStrategy;
  /** Fecha de la última importación; vacía = todas las anotaciones */
  lastImportDate?: string;
}

export const DEFAULT_IMAGE_NAME_TEMPLATE = "{{ attachmentKey }}-{{ page }}-x{{ x }}-y{{ y }}";

const personName = (c: ZoteroCreator): string => c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" ");
const joinNames = (creators: ZoteroCreator[], type: string): string =>
  creators.filter((c) => c.creatorType === type).map(personName).join(", ");
const surname = (c: ZoteroCreator): string => c.lastName ?? c.name ?? "";
const firstSurname = (creators: ZoteroCreator[]): string => {
  const c = creators.find((x) => x.creatorType === "author") ?? creators[0];
  return c ? surname(c) : "";
};
/** Apellidos de los autores (o, si no hay, de los creadores), separados por coma */
const surnames = (creators: ZoteroCreator[]): string => {
  const authors = creators.filter((c) => c.creatorType === "author");
  return (authors.length ? authors : creators).map(surname).filter(Boolean).join(", ");
};

function attachmentLabel(a: ZoteroAttachment): string {
  return a.title || a.filename || "Adjunto";
}

/** Ruta absoluta del archivo local de un adjunto, o null si no tiene (enlaces, etc.). */
export function attachmentFilePath(a: ZoteroAttachment, dataDir: string): string | null {
  if (a.linkMode === "imported_file" || a.linkMode === "imported_url") {
    return a.filename ? `${dataDir.replace(/[\\/]+$/, "")}/storage/${a.key}/${a.filename}` : null;
  }
  if (a.linkMode === "linked_file") return a.path || null;
  return null;
}

export function annotationContext(index: LibraryIndex, a: ZoteroAnnotation, opts: ContextOptions): Record<string, unknown> {
  const attachment = index.attachments.get(a.parentKey);
  const isPdf = !!attachment && /pdf/i.test(attachment.contentType);
  const pdfPosition = !!a.position && a.position.rects.length > 0;

  let imageRelativePath = "";
  let imagePath = "";
  if (a.type === "image" && isZoteroKey(a.key)) {
    imagePath = `${opts.dataDir.replace(/[\\/]+$/, "")}/cache/library/${a.key}.png`;
    const parts = imageParts(a, opts.imageStrategy ?? DEFAULT_IMAGE_NAME_STRATEGY);
    if (parts) {
      const name = opts.renderString(opts.imageNameTemplate || DEFAULT_IMAGE_NAME_TEMPLATE, {
        attachmentKey: a.parentKey,
        itemKey: index.itemKeyOf(a) ?? "",
        annotationKey: a.key,
        page: parts.page,
        pageLabel: a.pageLabel,
        x: parts.x,
        y: parts.y,
        color: a.colorCategory,
      });
      imageRelativePath = makeImageRelativePath(opts.imagesFolder, name) ?? "";
    }
  }

  return {
    // Nombres compatibles con Zotero Integration
    id: a.key,
    type: a.type,
    annotatedText: a.text,
    comment: a.comment,
    color: a.color,
    colorCategory: a.colorCategory,
    pageLabel: a.pageLabel,
    date: a.dateAdded,
    tags: a.tags.map((t) => ({ tag: t.tag, type: t.type })),
    attachment: attachment ? { itemKey: attachment.key, key: attachment.key, title: attachment.title, filename: attachment.filename, contentType: attachment.contentType } : { itemKey: a.parentKey },
    // Siempre `open` sobre el adjunto: con página para PDF, y solo con la clave de la anotación si no la tiene (capturas web, EPUB).
    desktopURI: a.parentKey ? openAnnotationUri(a.parentKey, a.pageLabel, a.key) : undefined,
    imageRelativePath,
    // Nombres propios
    key: a.key,
    text: a.text,
    colorExact: a.colorExact,
    page: a.position ? a.position.pageIndex + 1 : undefined,
    position: a.position,
    sortIndex: a.sortIndex,
    authorName: a.authorName,
    dateAdded: a.dateAdded,
    dateModified: a.dateModified,
    imagePath,
    itemKey: index.itemKeyOf(a),
    fields: a.fields,
    raw: a.raw,
  };
}

function creatorsContext(creators: ZoteroCreator[]) {
  return creators.map((c) => ({ ...c }));
}

/**
 * Contexto de una plantilla de ámbito ítem. Es plano (`{{ title }}`,
 * `{{ publisher }}`…) como en Zotero Integration: todos los campos escalares de
 * Zotero están al nivel superior, además de `creators`, `annotations`, etc.
 */
export function itemContext(
  index: LibraryIndex,
  item: ZoteroItem,
  annotations: ZoteroAnnotation[],
  allAnnotations: ZoteroAnnotation[],
  opts: ContextOptions,
): Record<string, unknown> {
  const attachments = index.attachmentsOf(item.key);
  const first = attachments[0];
  const firstPath = first ? attachmentFilePath(first, opts.dataDir) : null;
  // Adjunto principal para los enlaces «Zotero» y «Local»: el primer PDF y, si no hay, el primero
  const primary = attachments.find((a) => /pdf/i.test(a.contentType)) ?? first;
  const primaryPath = primary ? attachmentFilePath(primary, opts.dataDir) : null;

  const relations = index.relatedItems(item).map((r) => ({
    ...r.fields,
    key: r.key,
    itemKey: r.key,
    title: r.title,
    creators: creatorsContext(r.creators),
    desktopURI: zoteroSelectUri(r.key),
    itemType: r.itemType,
  }));

  const ctx: Record<string, unknown> = {
    ...item.fields, // todos los campos de Zotero, con sus nombres originales
    key: item.key,
    itemKey: item.key,
    itemType: item.itemType,
    itemTypeLabel: itemTypeLabel(item.itemType), // nombre en español; `itemType` sigue en inglés
    title: item.title,
    // `date` en formato ISO para poder usar {{ date | format("YYYY-MM-DD") }}; el texto original queda en `dateText`
    date: item.isoDate ?? item.fields.date ?? "",
    dateText: item.fields.date ?? "",
    year: item.year,
    creators: creatorsContext(item.creators),
    authors: joinNames(item.creators, "author"),
    authorSurnames: surnames(item.creators),
    firstAuthorSurname: firstSurname(item.creators),
    editors: joinNames(item.creators, "editor"),
    directors: joinNames(item.creators, "director"),
    translators: joinNames(item.creators, "translator"),
    contributors: joinNames(item.creators, "contributor"),
    tags: item.tags.map((t) => ({ tag: t.tag, type: t.type })),
    allTags: item.tags.map((t) => t.tag).join(", "),
    collections: item.collections.map((k) => index.collections.get(k)?.name ?? k),
    attachments: attachments.map((a) => ({
      ...a.fields,
      key: a.key,
      itemKey: a.key,
      title: a.title,
      filename: a.filename,
      contentType: a.contentType,
      path: attachmentFilePath(a, opts.dataDir) ?? "",
    })),
    firstAttachmentLink: first && firstPath ? markdownLink(attachmentLabel(first), fileUri(firstPath)) : "",
    firstAttachmentZoteroLink: first ? markdownLink(attachmentLabel(first), zoteroSelectUri(first.key)) : "",
    relations,
    desktopURI: zoteroSelectUri(item.key),
    select: zoteroSelectUri(item.key),
    // «Zotero» abre el adjunto principal (`open`); sin adjunto se queda en seleccionar el ítem. «Local» solo si hay archivo.
    // En un PDF abre en la primera página (?page=1).
    openURI: primary ? zoteroOpenFirstPageUri(primary.key, /pdf/i.test(primary.contentType)) : zoteroSelectUri(item.key),
    localURI: primaryPath ? localFileLink(primaryPath) : "",
    annotations: annotations.map((a) => annotationContext(index, a, opts)),
    allAnnotations: allAnnotations.map((a) => annotationContext(index, a, opts)),
    item: { key: item.key, itemType: item.itemType, title: item.title, fields: item.fields, creators: creatorsContext(item.creators), tags: item.tags, raw: item.raw },
    raw: item.raw,
  };
  if (opts.lastImportDate) ctx.lastImportDate = opts.lastImportDate;
  return ctx;
}

/** Contexto de una plantilla de ámbito anotación: la anotación y su ítem padre, planos. */
export function standaloneAnnotationContext(
  index: LibraryIndex,
  a: ZoteroAnnotation,
  opts: ContextOptions,
  position = 1,
): Record<string, unknown> {
  const parentKey = index.itemKeyOf(a);
  const parent = parentKey ? index.entry(parentKey) : undefined;
  const base = parent ? itemContext(index, parent, [], [], opts) : {};
  return { ...base, annotation: annotationContext(index, a, opts), index: position };
}

export { relatedItemKeys };

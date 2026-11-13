/**
 * Modelo de datos del plugin.
 *
 * Principio: nada se pierde. Cada entidad conserva el objeto crudo de la API
 * (`raw`) y todos sus campos escalares (`fields`), de modo que cualquier campo de
 * un ítem o de una anotación se pueda leer, filtrar, renderizar o imprimir.
 */

export interface ZoteroApiData {
  key: string;
  version: number;
  itemType: string;
  [field: string]: unknown;
}

export interface ZoteroApiObject {
  key: string;
  version: number;
  library?: { type: string; id: number; name?: string };
  links?: Record<string, { href: string; type?: string }>;
  meta?: Record<string, unknown>;
  data: ZoteroApiData;
}

export interface ZoteroTag {
  tag: string;
  /** 0 = manual, 1 = automática */
  type: number;
}

export interface ZoteroCreator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** Para creadores de campo único (fieldMode 1) */
  name?: string;
}

interface EntityBase {
  key: string;
  version: number;
  /** Todos los campos escalares de `data`, con sus nombres originales de Zotero */
  fields: Record<string, string>;
  tags: ZoteroTag[];
  collections: string[];
  /** predicado -> URIs */
  relations: Record<string, string[]>;
  dateAdded: string;
  dateModified: string;
  raw: ZoteroApiObject;
}

export interface ZoteroItem extends EntityBase {
  kind: "item";
  itemType: string;
  title: string;
  creators: ZoteroCreator[];
  creatorSummary?: string;
  /** meta.parsedDate tal como lo entrega Zotero */
  parsedDate?: string;
  /** YYYY-MM-DD; las fechas parciales se completan con 01 */
  isoDate?: string;
  year?: number;
  attachmentKeys: string[];
  noteKeys: string[];
  /** true en el ítem sintético que representa un adjunto sin contenedor (PDF suelto o con padre ausente) */
  fromAttachment?: boolean;
}

export interface ZoteroAttachment extends EntityBase {
  kind: "attachment";
  parentKey: string | null;
  title: string;
  contentType: string;
  linkMode: string;
  filename: string;
  path: string;
  annotationKeys: string[];
}

export interface ZoteroNote extends EntityBase {
  kind: "note";
  parentKey: string | null;
  note: string;
}

export interface AnnotationPosition {
  pageIndex: number;
  rects: number[][];
  [extra: string]: unknown;
}

export interface ZoteroAnnotation extends EntityBase {
  kind: "annotation";
  /** Clave del adjunto al que pertenece */
  parentKey: string;
  /** highlight, underline, note, image, ink, text */
  type: string;
  text: string;
  comment: string;
  /** Color hexadecimal en minúsculas, p. ej. #ffd400 */
  color: string;
  /** yellow, red, green, blue, purple, magenta, orange, gray (el más cercano) */
  colorCategory: string;
  /** false si el hexadecimal no es uno de los ocho colores estándar */
  colorExact: boolean;
  pageLabel: string;
  sortIndex: string;
  authorName: string;
  position: AnnotationPosition | null;
}

export type ZoteroEntity = ZoteroItem | ZoteroAttachment | ZoteroNote | ZoteroAnnotation;

export interface ZoteroCollection {
  key: string;
  version: number;
  name: string;
  parentKey: string | null;
  raw: ZoteroApiObject;
}

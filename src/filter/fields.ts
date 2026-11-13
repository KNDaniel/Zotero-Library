import { itemTypeLabel } from "../model/itemTypes";
import type { LibraryIndex } from "../index/LibraryIndex";
import type { ZoteroCreator, ZoteroItem } from "../model/types";
import { norm } from "./text";

/** Pseudocampo para los términos sin `@campo:` (busca en todos los campos). */
export const ANY_FIELD = "*";

/** Alias en español y nombres cortos -> campo canónico. Claves ya normalizadas. */
const ALIASES: Record<string, string> = {
  autor: "author", autores: "author", author: "author",
  editor: "editor", editores: "editor",
  traductor: "translator", traductores: "translator", translator: "translator",
  director: "director", directores: "director",
  creador: "creator", creadores: "creator", creator: "creator",
  ano: "year", anio: "year", year: "year",
  siglo: "century",
  fecha: "date", date: "date",
  titulo: "title", title: "title",
  tipo: "itemType", itemtype: "itemType",
  coleccion: "collection", colecciones: "collection", collection: "collection",
  etiqueta: "tag", etiquetas: "tag", tag: "tag", tags: "tag",
  clave: "key", key: "key",
  resumen: "abstractNote", abstract: "abstractNote",
  editorial: "publisher",
  revista: "publicationTitle", publicacion: "publicationTitle",
  libro: "bookTitle",
  idioma: "language", lengua: "language",
  lugar: "place",
  volumen: "volume",
  edicion: "edition",
  paginas: "pages",
  serie: "series",
  universidad: "university",
};

/** Campos virtuales que no son un campo escalar de Zotero. */
const VIRTUAL = new Set(["author", "editor", "translator", "director", "creator", "year", "century", "date", "title", "itemType", "collection", "tag", "key"]);

/** Nombres amigables para autocompletar tras `@`. */
export const FIELD_SUGGESTIONS = [
  "autor", "editor", "traductor", "director", "creador", "año", "siglo", "fecha", "título", "tipo",
  "colección", "etiqueta", "clave", "resumen", "editorial", "revista", "libro", "idioma", "lugar",
  "volumen", "edición", "páginas", "serie", "universidad",
];

/**
 * Resuelve el nombre escrito por el usuario. Devuelve el campo canónico (virtual
 * o alias) o el nombre tal cual, para casarlo después sin distinguir mayúsculas
 * con los campos reales de Zotero (`publicationTitle`, `ISBN`…).
 */
export function resolveFieldName(name: string): string {
  return ALIASES[norm(name)] ?? name;
}

export function isVirtualField(canonical: string): boolean {
  return VIRTUAL.has(canonical);
}

export interface EvalContext {
  collectionName(key: string): string;
}

export function contextOf(index: LibraryIndex): EvalContext {
  return { collectionName: (key) => index.collections.get(key)?.name ?? key };
}

function creatorStrings(creators: ZoteroCreator[]): string[] {
  const out: string[] = [];
  for (const c of creators) {
    const first = c.firstName ?? "";
    const last = c.lastName ?? "";
    if (c.name) out.push(c.name);
    if (first || last) {
      out.push(`${first} ${last}`.trim());
      out.push(`${last}, ${first}`.replace(/, $/, ""));
    }
  }
  return out;
}

/**
 * Valores de un campo para un ítem (varios si el campo es multivalor, como los
 * autores). Con `comparing` se devuelven solo valores aptos para >, <, entre.
 */
export function fieldValues(item: ZoteroItem, field: string, ctx: EvalContext, comparing = false): string[] {
  switch (field) {
    case ANY_FIELD:
      return [...Object.values(item.fields), item.title, ...creatorStrings(item.creators), ...item.tags.map((t) => t.tag)];
    case "author":
    case "editor":
    case "translator":
    case "director":
      return creatorStrings(item.creators.filter((c) => c.creatorType === field));
    case "creator":
      return creatorStrings(item.creators);
    case "year":
    case "century":
      return item.year !== undefined ? [String(item.year)] : [];
    case "date":
      return comparing ? (item.isoDate ? [item.isoDate] : []) : [item.isoDate, item.fields.date].filter((v): v is string => !!v);
    case "title":
      return item.title ? [item.title] : [];
    case "itemType":
      return [item.itemType, itemTypeLabel(item.itemType)]; // acepta el nombre de Zotero y el español
    case "collection":
      return item.collections.map((k) => ctx.collectionName(k));
    case "tag":
      return item.tags.map((t) => t.tag);
    case "key":
      return [item.key];
    default: {
      const wanted = norm(field);
      for (const [k, v] of Object.entries(item.fields)) if (norm(k) === wanted) return v ? [v] : [];
      return [];
    }
  }
}

/** Nombres de campo reales presentes en la biblioteca (para avisar de campos desconocidos). */
export function knownFieldNames(index: LibraryIndex): Set<string> {
  const out = new Set<string>();
  for (const item of index.items.values()) for (const k of Object.keys(item.fields)) out.add(norm(k));
  return out;
}

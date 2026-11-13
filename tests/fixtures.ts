import type { ZoteroApiObject } from "../src/model/types";

/**
 * Fixtures SINTÉTICOS con la forma de la API web de Zotero (v3). No son
 * capturas de tu biblioteca: sirven para probar la lógica; la forma real se
 * comprueba con el informe de verificación dentro de Obsidian.
 */
export function item(key: string, over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): ZoteroApiObject {
  return {
    key,
    version: 10,
    library: { type: "user", id: 1, name: "u" },
    meta: { creatorSummary: "Marx", parsedDate: "2010-06", numChildren: 1, ...meta },
    data: {
      key,
      version: 10,
      itemType: "bookSection",
      title: `Título ${key}`,
      creators: [
        { creatorType: "author", firstName: "Karl", lastName: "Marx" },
        { creatorType: "translator", firstName: "Pedro", lastName: "Scaron" },
      ],
      date: "junio de 2010",
      publisher: "Siglo Veintiuno",
      ISBN: "978-84-323-1592-3",
      tags: [{ tag: "marxismo", type: 0 }],
      collections: [],
      relations: {},
      dateAdded: "2024-01-01T00:00:00Z",
      dateModified: "2024-01-02T00:00:00Z",
      ...over,
    },
  };
}

export function attachment(key: string, parent: string | null, over: Record<string, unknown> = {}): ZoteroApiObject {
  const data: Record<string, unknown> = {
    key,
    version: 11,
    itemType: "attachment",
    title: "PDF",
    linkMode: "imported_file",
    contentType: "application/pdf",
    filename: `${key}.pdf`,
    tags: [],
    relations: {},
    dateAdded: "2024-01-01T00:00:00Z",
    dateModified: "2024-01-01T00:00:00Z",
    ...over,
  };
  if (parent) data.parentItem = parent;
  return { key, version: 11, data: data as ZoteroApiObject["data"] };
}

export function annotation(
  key: string,
  parent: string,
  over: Record<string, unknown> = {},
): ZoteroApiObject {
  return {
    key,
    version: 12,
    data: {
      key,
      version: 12,
      itemType: "annotation",
      parentItem: parent,
      annotationType: "highlight",
      annotationText: "texto subrayado",
      annotationComment: "comentario",
      annotationColor: "#ffd400",
      annotationPageLabel: "VIII",
      annotationSortIndex: "00007|001234|00100",
      annotationPosition: JSON.stringify({ pageIndex: 7, rects: [[98.4, 640.2, 300.1, 662.4]] }),
      tags: [],
      relations: {},
      dateAdded: "2024-02-01T00:00:00Z",
      dateModified: "2024-02-01T00:00:00Z",
      ...over,
    } as ZoteroApiObject["data"],
  };
}

export function collection(key: string, name: string, parent: string | false = false): ZoteroApiObject {
  return {
    key,
    version: 5,
    data: { key, version: 5, name, parentCollection: parent, relations: {} } as unknown as ZoteroApiObject["data"],
  };
}

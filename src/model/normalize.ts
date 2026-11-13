import { colorCategoryOf } from "./colors";
import { toIsoDate } from "./dates";
import type {
  AnnotationPosition,
  ZoteroAnnotation,
  ZoteroApiData,
  ZoteroApiObject,
  ZoteroAttachment,
  ZoteroCollection,
  ZoteroCreator,
  ZoteroEntity,
  ZoteroItem,
  ZoteroNote,
  ZoteroTag,
} from "./types";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Todos los campos escalares de `data` (cadenas, números y booleanos) como texto. */
export function scalarFields(data: ZoteroApiData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "key" || k === "version" || k === "itemType") continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return out;
}

export function normalizeTags(v: unknown): ZoteroTag[] {
  if (!Array.isArray(v)) return [];
  const out: ZoteroTag[] = [];
  for (const t of v) {
    if (isRecord(t) && typeof t.tag === "string") {
      out.push({ tag: t.tag, type: typeof t.type === "number" ? t.type : 0 });
    }
  }
  return out;
}

export function normalizeCreators(v: unknown): ZoteroCreator[] {
  if (!Array.isArray(v)) return [];
  const out: ZoteroCreator[] = [];
  for (const c of v) {
    if (!isRecord(c)) continue;
    const creator: ZoteroCreator = { creatorType: str(c.creatorType) };
    if (typeof c.firstName === "string") creator.firstName = c.firstName;
    if (typeof c.lastName === "string") creator.lastName = c.lastName;
    if (typeof c.name === "string") creator.name = c.name;
    out.push(creator);
  }
  return out;
}

export function normalizeRelations(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!isRecord(v)) return out; // Zotero puede devolver [] cuando no hay relaciones
  for (const [predicate, value] of Object.entries(v)) {
    if (typeof value === "string") out[predicate] = [value];
    else if (Array.isArray(value)) out[predicate] = value.filter((x): x is string => typeof x === "string");
  }
  return out;
}

/** Claves de los ítems relacionados (predicado dc:relation) a partir de sus URIs. */
export function relatedItemKeys(relations: Record<string, string[]>): string[] {
  const keys: string[] = [];
  for (const uri of relations["dc:relation"] ?? []) {
    const m = /\/items\/([A-Z0-9]{8})(?:$|[/?#])/.exec(uri);
    if (m) keys.push(m[1]);
  }
  return keys;
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parsePosition(v: unknown): AnnotationPosition | null {
  let value: unknown = v;
  if (typeof v === "string") {
    try {
      value = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || typeof value.pageIndex !== "number") return null;
  const rects = Array.isArray(value.rects)
    ? value.rects.filter((r): r is number[] => Array.isArray(r) && r.every((n) => typeof n === "number"))
    : [];
  return { ...value, pageIndex: value.pageIndex, rects };
}

function base(obj: ZoteroApiObject) {
  const d = obj.data;
  return {
    key: obj.key ?? d.key,
    version: obj.version ?? d.version,
    fields: scalarFields(d),
    tags: normalizeTags(d.tags),
    collections: stringArray(d.collections),
    relations: normalizeRelations(d.relations),
    dateAdded: str(d.dateAdded),
    dateModified: str(d.dateModified),
    raw: obj,
  };
}

const TITLE_FIELDS = ["title", "caseName", "nameOfAct", "subject", "name", "billNumber"];

export function normalizeEntity(obj: ZoteroApiObject): ZoteroEntity {
  if (!obj || !obj.data) throw new Error("Objeto de Zotero sin `data`");
  const d = obj.data;
  const b = base(obj);

  switch (d.itemType) {
    case "annotation": {
      const color = str(d.annotationColor).toLowerCase();
      const { category, exact } = colorCategoryOf(color);
      const a: ZoteroAnnotation = {
        ...b,
        kind: "annotation",
        parentKey: str(d.parentItem),
        type: str(d.annotationType),
        text: str(d.annotationText),
        comment: str(d.annotationComment),
        color,
        colorCategory: category,
        colorExact: exact,
        pageLabel: str(d.annotationPageLabel),
        sortIndex: str(d.annotationSortIndex),
        authorName: str(d.annotationAuthorName),
        position: parsePosition(d.annotationPosition),
      };
      return a;
    }
    case "attachment": {
      const at: ZoteroAttachment = {
        ...b,
        kind: "attachment",
        parentKey: str(d.parentItem) || null,
        title: str(d.title),
        contentType: str(d.contentType),
        linkMode: str(d.linkMode),
        filename: str(d.filename),
        path: str(d.path),
        annotationKeys: [],
      };
      return at;
    }
    case "note": {
      const n: ZoteroNote = {
        ...b,
        kind: "note",
        parentKey: str(d.parentItem) || null,
        note: str(d.note),
      };
      return n;
    }
    default: {
      const title = TITLE_FIELDS.map((f) => b.fields[f]).find((t) => !!t) ?? "";
      const meta = obj.meta ?? {};
      const parsedDate = typeof meta.parsedDate === "string" ? meta.parsedDate : undefined;
      const isoDate = toIsoDate(parsedDate, b.fields.date);
      const item: ZoteroItem = {
        ...b,
        kind: "item",
        itemType: d.itemType,
        title,
        creators: normalizeCreators(d.creators),
        creatorSummary: typeof meta.creatorSummary === "string" ? meta.creatorSummary : undefined,
        parsedDate,
        isoDate,
        year: isoDate ? Number(isoDate.slice(0, 4)) : undefined,
        attachmentKeys: [],
        noteKeys: [],
      };
      return item;
    }
  }
}

export function normalizeCollection(obj: ZoteroApiObject): ZoteroCollection {
  const d = obj.data;
  const parent = d.parentCollection;
  return {
    key: obj.key ?? d.key,
    version: obj.version ?? d.version,
    name: str(d.name),
    parentKey: typeof parent === "string" && parent ? parent : null,
    raw: obj,
  };
}

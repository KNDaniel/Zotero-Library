import fs from "node:fs";
import path from "node:path";
import type { ZoteroApiObject } from "../src/model/types";

const dir = path.join(__dirname, "fixtures");
export const golden = JSON.parse(fs.readFileSync(path.join(dir, "golden.json"), "utf8"));
export const template = fs.readFileSync(path.join(dir, "template-import-anotaciones.md"), "utf8");
export const note = fs.readFileSync(path.join(dir, "golden-note.md"), "utf8").replace(/\r\n/g, "\n");
export const ITEM_KEY = "ITEM0001";

const person = (full: string) => {
  const [first, ...rest] = full.split(" ");
  return { first, last: rest.join(" ") };
};

export function goldenEntities(): ZoteroApiObject[] {
  const author = person(golden.authors[0]);
  const translator = person(golden.translators[0]);
  const title = golden.fullTitle;
  const entities: ZoteroApiObject[] = [
    {
      key: ITEM_KEY,
      version: 1,
      meta: { parsedDate: "2010-06" },
      data: {
        key: ITEM_KEY,
        version: 1,
        itemType: "bookSection",
        title,
        creators: [
          { creatorType: "author", firstName: author.first, lastName: author.last },
          { creatorType: "translator", firstName: translator.first, lastName: translator.last },
        ],
        date: "2010-Jun",
        publisher: golden.publisher,
        ISBN: golden.isbn,
        tags: [],
        collections: [],
        relations: { "dc:relation": [`http://zotero.org/users/1/items/${golden.related.key}`] },
        dateAdded: "2024-01-01T00:00:00Z",
        dateModified: "2024-01-01T00:00:00Z",
      },
    },
    {
      key: golden.related.key,
      version: 1,
      data: {
        key: golden.related.key,
        version: 1,
        itemType: "bookSection",
        title: golden.related.title,
        creators: [{ creatorType: "author", firstName: golden.related.first, lastName: golden.related.last }],
        tags: [],
        collections: [],
        relations: {},
        dateAdded: "2024-01-01T00:00:00Z",
        dateModified: "2024-01-01T00:00:00Z",
      },
    },
    {
      key: golden.attachmentKey,
      version: 1,
      data: {
        key: golden.attachmentKey,
        version: 1,
        itemType: "attachment",
        parentItem: ITEM_KEY,
        title: golden.zoteroLabel,
        linkMode: "imported_file",
        contentType: "application/pdf",
        filename: golden.filename,
        tags: [],
        relations: {},
        dateAdded: "2024-01-01T00:00:00Z",
        dateModified: "2024-01-01T00:00:00Z",
      },
    },
  ];

  golden.annotations.forEach((a: Record<string, any>, i: number) => {
    let position = { pageIndex: 0, rects: [[1, 2, 3, 4]] };
    const m = /-(\d+)-x(\d+)-y(\d+)\.png$/.exec(a.imageRelativePath);
    if (m) position = { pageIndex: Number(m[1]) - 1, rects: [[Number(m[2]), Number(m[3]), Number(m[2]) + 100, Number(m[3]) + 100]] };
    entities.push({
      key: a.id,
      version: 1,
      data: {
        key: a.id,
        version: 1,
        itemType: "annotation",
        parentItem: golden.attachmentKey,
        annotationType: a.type,
        annotationText: a.text,
        annotationComment: a.comment,
        annotationColor: a.color,
        annotationPageLabel: a.pageLabel,
        annotationSortIndex: `${String(i).padStart(5, "0")}|000000|00000`,
        annotationPosition: JSON.stringify(position),
        tags: a.tags.map((t: string) => ({ tag: t, type: 0 })),
        relations: {},
        dateAdded: new Date(Date.UTC(2024, 1, 1, 0, 0, i)).toISOString(),
        dateModified: "2024-02-01T00:00:00Z",
      },
    });
  });
  return entities;
}

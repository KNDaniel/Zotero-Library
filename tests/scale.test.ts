import { describe, expect, it } from "vitest";
import { mergeChanges, packCache, unpackCache } from "../src/index/cache";
import { LibraryIndex } from "../src/index/LibraryIndex";
import type { ZoteroApiObject } from "../src/model/types";
import { defaultViewState, derive } from "../src/ui/state";
import { annotation, attachment, collection, item } from "./fixtures";

/**
 * Biblioteca del tamaño de la tuya (564 ítems, 617 adjuntos, 24 notas, 10 500
 * anotaciones, 55 colecciones, ~2 800 etiquetas) para vigilar los tiempos.
 */
function bigLibrary() {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const words = "capital mercancía valor trabajo fuerza dinero ley economía sociedad historia espíritu ideología clase producción".split(" ");
  const sentence = (n: number) => Array.from({ length: n }, () => pick(words)).join(" ");
  const tagPool = Array.from({ length: 2782 }, (_, i) => `etiqueta ${i} ${pick(words)}`);

  const entities: ZoteroApiObject[] = [];
  const cols = Array.from({ length: 55 }, (_, i) => collection(`COL${String(i).padStart(5, "0")}`, `Colección ${i}`, i > 8 ? `COL${String(i % 9).padStart(5, "0")}` : false));
  for (let i = 0; i < 564; i++) {
    const key = `IT${String(i).padStart(6, "0")}`;
    entities.push(item(key, {
      title: `Título ${i} ${sentence(5)}`, creators: [{ creatorType: "author", firstName: sentence(1), lastName: `Apellido${i % 200}` }],
      date: String(1800 + (i % 220)), abstractNote: sentence(60), publisher: sentence(2), collections: [cols[i % 55].key],
      tags: [{ tag: pick(tagPool), type: 0 }],
    }, { parsedDate: String(1800 + (i % 220)) }));
  }
  for (let a = 0; a < 617; a++) entities.push(attachment(`AT${String(a).padStart(6, "0")}`, a < 564 ? `IT${String(a).padStart(6, "0")}` : null));
  for (let n = 0; n < 24; n++) entities.push({ key: `NT${String(n).padStart(6, "0")}`, version: 1, data: { key: `NT${String(n).padStart(6, "0")}`, version: 1, itemType: "note", parentItem: `IT${String(n).padStart(6, "0")}`, note: `<p>${sentence(30)}</p>`, tags: [], relations: {}, dateAdded: "2024-01-01T00:00:00Z", dateModified: "2024-01-01T00:00:00Z" } });
  for (let k = 0; k < 10500; k++) {
    const att = `AT${String(k % 560).padStart(6, "0")}`;
    entities.push(annotation(`AN${String(k).padStart(6, "0")}`, att, {
      annotationText: sentence(30 + Math.floor(rnd() * 40)), annotationComment: rnd() > 0.5 ? sentence(15) : "",
      annotationSortIndex: `${String(Math.floor(k / 560)).padStart(5, "0")}|${String(Math.floor(rnd() * 99999)).padStart(6, "0")}|00100`,
      tags: Array.from({ length: Math.floor(rnd() * 4) }, () => ({ tag: pick(tagPool), type: 0 })),
    }));
  }
  return { entities, collections: cols, libraryVersion: 9757, total: entities.length, truncated: false };
}

const time = <T,>(label: string, fn: () => T, log: string[]): T => {
  const t0 = performance.now();
  const r = fn();
  log.push(`${label}: ${Math.round(performance.now() - t0)} ms`);
  return r;
};

describe("rendimiento a la escala de tu biblioteca", () => {
  it("las fases de apertura se mantienen en tiempos razonables", async () => {
    const log: string[] = [];
    const raw = bigLibrary();
    const index = time("fromRaw (normalizar e indexar 11 705 entidades)", () => LibraryIndex.fromRaw(raw), log);
    expect(index.stats().annotations).toBe(10500);
    const back = time("toRaw", () => index.toRaw(), log);
    const t0 = performance.now();
    const packed = await packCache(back, { savedAt: 1, libraryPath: "users/0", plugin: "t" });
    log.push(`packCache: ${Math.round(performance.now() - t0)} ms → ${(packed.byteLength / 1e6).toFixed(1)} MB comprimidos`);
    const t1 = performance.now();
    const unpacked = await unpackCache(packed);
    log.push(`unpackCache: ${Math.round(performance.now() - t1)} ms`);
    expect(unpacked?.raw.entities).toHaveLength(raw.entities.length);
    time("fromRaw desde la copia", () => LibraryIndex.fromRaw(unpacked!.raw), log);
    time("mergeChanges (82 cambios)", () => mergeChanges(back, { changed: raw.entities.slice(-82), changedCollections: [], deleted: { items: [], collections: [] }, libraryVersion: 9800 }), log);

    const none = time("derive sin selección", () => derive(index, defaultViewState()), log);
    // 564 ítems reales + los adjuntos sin contenedor (sueltos o con el padre ausente)
    expect(none.available.filter((i) => !i.fromAttachment)).toHaveLength(564);
    expect(none.listAttachments.length).toBe(index.attachmentItems.size);
    expect(none.available).toHaveLength(564 + index.attachmentItems.size);
    const all = time("derive con los 564 ítems seleccionados", () => derive(index, { ...defaultViewState(), selectedItems: none.available.map((i) => i.key) }), log);
    expect(all.tags.tags.length).toBeGreaterThan(100);
    time("derive en modo anotación, agrupado por etiqueta", () => derive(index, { ...defaultViewState(), selectedItems: none.available.map((i) => i.key), mode: "annotation", annotationGroup: "tag" }), log);
    console.log(`\n${log.join("\n")}\n`);
  }, 120000);
});

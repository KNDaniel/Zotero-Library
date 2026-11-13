import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { buildListRows } from "../src/ui/listRows";
import { defaultViewState, derive, type ViewState } from "../src/ui/state";
import { annotation, attachment, collection, item } from "./fixtures";

const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });
const index = LibraryIndex.fromRaw({
  entities: [
    item("CAPITAL1", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867", collections: ["COLMARX"] }, { parsedDate: "1867" }),
    item("FENOMEN1", { title: "Fenomenología del espíritu", creators: [au("Georg", "Hegel")], date: "1807", collections: ["COLHEGEL"] }, { parsedDate: "1807" }),
    attachment("ATTCAP01", "CAPITAL1"),
    attachment("ATTFEN01", "FENOMEN1"),
    annotation("ANNA0001", "ATTCAP01", { annotationSortIndex: "00001|000001|00001", tags: [{ tag: "Tomo I", type: 0 }] }),
    annotation("ANNF0001", "ATTFEN01", { annotationSortIndex: "00001|000001|00001", tags: [{ tag: "espíritu", type: 0 }] }),
  ],
  collections: [collection("COLMARX", "Marx"), collection("COLHEGEL", "Hegel")],
  libraryVersion: 1,
  total: 0,
  truncated: false,
});
const st = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultViewState(), ...over });
const keys = (l: Array<{ key: string }>) => l.map((x) => x.key);

describe("0.9.2: la selección sobrevive a búsquedas y filtros", () => {
  it("una búsqueda que oculta un ítem seleccionado no lo deselecciona", () => {
    const d = derive(index, st({ selectedItems: ["CAPITAL1", "FENOMEN1"], searchText: "@autor: Marx" }));
    expect(keys(d.available)).toEqual(["CAPITAL1"]);
    expect(d.selectedItems.sort()).toEqual(["CAPITAL1", "FENOMEN1"]);
    expect(keys(d.selectedHidden)).toEqual(["FENOMEN1"]);
  });

  it("los ítems ocultos siguen aportando resultados, etiquetas y marcas", () => {
    const d = derive(index, st({ selectedItems: ["FENOMEN1"], searchText: "@autor: Marx", markedItems: ["FENOMEN1"], markedAnnotations: ["ANNF0001"] }));
    expect(keys(d.results.items)).toEqual(["FENOMEN1"]);
    expect(d.tags.tags.map((t) => t.tag)).toEqual(["espíritu"]);
    expect(d.markedItems).toEqual(["FENOMEN1"]);
    expect(d.markedAnnotations).toEqual(["ANNF0001"]);
  });

  it("limitar por colección tampoco deselecciona", () => {
    const d = derive(index, st({ selectedItems: ["FENOMEN1"], collections: ["COLMARX"] }));
    expect(d.selectedItems).toEqual(["FENOMEN1"]);
  });

  it("una clave que ya no existe en la biblioteca sí se descarta", () => {
    const d = derive(index, st({ selectedItems: ["FENOMEN1", "FANTASMA"] }));
    expect(d.selectedItems).toEqual(["FENOMEN1"]);
  });

  it("«Seleccionados» muestra los ocultos marcados como fuera de la búsqueda", () => {
    const d = derive(index, st({ selectedItems: ["CAPITAL1", "FENOMEN1"], searchText: "@autor: Marx" }));
    const rows = buildListRows(d, new Set());
    const sel = rows.filter((r) => r.type === "item" && r.section === "section:selected");
    expect(sel.map((r) => (r.type === "item" ? [r.item.key, !!r.hidden] : null))).toEqual([["CAPITAL1", false], ["FENOMEN1", true]]);
    expect(rows[0]).toMatchObject({ type: "header", count: 2 });
  });
});

import { ITEM_TYPE_LABELS, itemTypeLabel } from "../src/model/itemTypes";
import { itemMatches } from "../src/filter/evaluate";
import { parseQuery } from "../src/filter/query";
import { itemContext } from "../src/template/context";
import { tagCounts, annotationBase } from "../src/filter/selection";

describe("0.9.2: tipos de ítem en español", () => {
  it("traduce los tipos conocidos y deja los desconocidos tal cual", () => {
    expect(itemTypeLabel("bookSection")).toBe("Capítulo de libro");
    expect(itemTypeLabel("journalArticle")).toBe("Artículo de revista académica");
    expect(itemTypeLabel("tipoNuevoDeZotero")).toBe("tipoNuevoDeZotero");
    expect(Object.keys(ITEM_TYPE_LABELS)).toHaveLength(39);
  });

  it("la variable itemType de las plantillas sigue en inglés y itemTypeLabel da el español", () => {
    const it0 = index.entry("CAPITAL1")!;
    const ctx = itemContext(index, it0, [], [], { dataDir: "" } as never) as Record<string, unknown>;
    expect(ctx.itemType).toBe(it0.itemType);
    expect(ctx.itemTypeLabel).toBe(itemTypeLabel(it0.itemType));
  });

  it("@tipo: acepta el nombre de Zotero y el español", () => {
    const it0 = index.entry("CAPITAL1")!;
    const ctx = { collectionName: (k: string) => k } as never;
    const en = parseQuery(`@tipo: ${it0.itemType}`, "and").spec;
    const es = parseQuery(`@tipo: ${itemTypeLabel(it0.itemType)}`, "and").spec;
    expect(itemMatches(it0, en, ctx)).toBe(true);
    expect(itemMatches(it0, es, ctx)).toBe(true);
  });
});

describe("0.9.2: contadores con O", () => {
  it("con O el contador es el total aunque haya etiquetas elegidas", () => {
    const base = annotationBase(index, ["CAPITAL1", "FENOMEN1"]);
    const counts = (m: "all" | "any") => Object.fromEntries(tagCounts(base, new Set(["Tomo I"]), m).map((e) => [e.tag, e.count]));
    expect(counts("any")).toEqual({ "Tomo I": 1, espíritu: 1 });
    expect(counts("all")).toEqual({ "Tomo I": 1 });
  });
});

import { formatSyncDate } from "../src/ui/syncDate";

describe("0.9.2: fecha de última sincronización", () => {
  it("formato «2026, nov 08 01:48» con meses abreviados en español", () => {
    expect(formatSyncDate(new Date(2026, 10, 8, 1, 48).getTime())).toBe("2026, nov 08 01:48");
    expect(formatSyncDate(new Date(2027, 0, 3, 14, 5).getTime())).toBe("2027, ene 03 14:05");
    expect(formatSyncDate(new Date(2026, 11, 31, 23, 59).getTime())).toBe("2026, dic 31 23:59");
  });
});

import { createWatchdog } from "../src/watchdog";

describe("0.9.2: vigilante del hilo principal", () => {
  const make = (hidden: { v: boolean }) => {
    const logs: string[] = [];
    const dog = createWatchdog({ periodMs: 1000, thresholdMs: 1500, isHidden: () => hidden.v, log: (m) => logs.push(m) });
    return { dog, logs };
  };

  it("avisa de un bloqueo real con la ventana visible", () => {
    const { dog, logs } = make({ v: false });
    const t = Date.now();
    dog.tick(t + 1000);
    dog.tick(t + 1000 + 1000 + 4000); // 4 s de retraso
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("4000 ms");
  });

  it("no avisa con la ventana oculta ni en el primer aviso al volver", () => {
    const hidden = { v: true };
    const { dog, logs } = make(hidden);
    const t = Date.now();
    dog.tick(t + 60_000); // temporizador frenado mientras está oculta
    hidden.v = false;
    dog.tick(t + 120_000); // primer aviso tras volver: el retraso es del frenado
    dog.tick(t + 121_000); // normal
    expect(logs).toEqual([]);
    dog.tick(t + 130_000); // bloqueo real ya con la ventana visible
    expect(logs).toHaveLength(1);
  });

  it("markHidden evita el falso aviso cuando se oculta y se muestra entre dos avisos", () => {
    const { dog, logs } = make({ v: false });
    const t = Date.now();
    dog.markHidden();
    dog.tick(t + 30_000);
    expect(logs).toEqual([]);
  });
});

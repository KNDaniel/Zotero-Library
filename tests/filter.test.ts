import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { itemMatches } from "../src/filter/evaluate";
import { contextOf, knownFieldNames } from "../src/filter/fields";
import { parseQuery, parseYearValue } from "../src/filter/query";
import {
  annotationMatchesTags,
  availableItems,
  computeResults,
  flattenAnnotations,
  tagPanel,
} from "../src/filter/selection";
import { groupAnnotations, groupItems, sortAnnotations, sortItems } from "../src/filter/sortGroup";
import { intToRoman, romanToInt } from "../src/filter/text";
import { annotation, attachment, collection, item } from "./fixtures";

const author = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });

const entities = [
  item("CAPITAL1", { title: "El Capital", creators: [author("Karl", "Marx")], date: "1867", publisher: "Akal", collections: ["COLMARX"], tags: [{ tag: "economía política", type: 0 }] }, { parsedDate: "1867" }),
  item("IDEOLOG1", { title: "La ideología alemana", creators: [author("Karl", "Marx"), author("Friedrich", "Engels")], date: "1846", collections: ["COLMARX"] }, { parsedDate: "1846" }),
  item("FENOMEN1", { title: "Fenomenología del espíritu", creators: [author("Georg", "Hegel")], date: "1807", collections: ["COLHEGEL"] }, { parsedDate: "1807" }),
  item("CRITICA1", { title: "Crítica de la razón pura", creators: [author("Immanuel", "Kant")], date: "1781", collections: ["COLHSUB1"] }, { parsedDate: "1781" }),
  item("PSICOPO1", { title: "Psicopolítica", creators: [author("Byung-Chul", "Han"), { creatorType: "translator", firstName: "Alfredo", lastName: "Bergés" }], date: "2014", volume: "3" }, { parsedDate: "2014" }),
  item("SINFECH1", { title: "Sin fecha", creators: [], date: "" }, { parsedDate: undefined }),
  attachment("ATTCAP01", "CAPITAL1"),
  attachment("ATTIDE01", "IDEOLOG1"),
  attachment("ATTFEN01", "FENOMEN1"),
  annotation("ANNA0001", "ATTCAP01", { annotationSortIndex: "00001|000001|00001", annotationColor: "#ffd400", tags: [{ tag: "Tomo I", type: 0 }, { tag: "mercancía", type: 0 }] }),
  annotation("ANNA0002", "ATTCAP01", { annotationSortIndex: "00002|000001|00001", annotationColor: "#ff6666", tags: [{ tag: "Tomo I", type: 0 }] }),
  annotation("ANNA0003", "ATTCAP01", { annotationSortIndex: "00003|000001|00001", annotationColor: "#5fb236", tags: [] }),
  annotation("ANNB0001", "ATTIDE01", { annotationSortIndex: "00001|000001|00001", annotationColor: "#ffd400", tags: [{ tag: "Feuerbach", type: 0 }, { tag: "mercancía", type: 0 }] }),
  annotation("ANNB0002", "ATTIDE01", { annotationSortIndex: "00002|000001|00001", annotationColor: "#a28ae5", tags: [] }),
];
const index = LibraryIndex.fromRaw({
  entities,
  collections: [collection("COLMARX", "Marx"), collection("COLHEGEL", "Hegel"), collection("COLHSUB1", "Hegel sub", "COLHEGEL")],
  libraryVersion: 1,
  total: entities.length,
  truncated: false,
});
const ctx = contextOf(index);
const keys = (list: Array<{ key: string }>) => list.map((x) => x.key).sort();
const search = (q: string, mode: "and" | "or" = "and") =>
  keys(availableItems(index, { collections: [], includeSubcollections: true, query: parseQuery(q, mode).spec }));

describe("números romanos", () => {
  it("convierte y valida la forma canónica", () => {
    expect(romanToInt("XIX")).toBe(19);
    expect(romanToInt("xviii")).toBe(18);
    expect(romanToInt("IIII")).toBeNull();
    expect(romanToInt("hola")).toBeNull();
    expect(intToRoman(1994)).toBe("MCMXCIV");
  });
});

describe("parser de la búsqueda rápida", () => {
  it("tu ejemplo: @autor: Marx | ideología | @año: XIX", () => {
    const { spec, warnings } = parseQuery("@autor: Marx | ideología | @año: XIX");
    expect(warnings).toEqual([]);
    expect(spec.mode).toBe("and");
    expect(spec.conditions).toEqual([
      { field: "author", op: "contains", value: "Marx", negate: false },
      { field: "*", op: "contains", value: "ideología", negate: false },
      { field: "year", op: "between", value: "1801", value2: "1900", negate: false },
    ]);
  });

  it("años, rangos, comparaciones y siglos", () => {
    expect(parseYearValue("1867")).toEqual({ op: "equals", value: "1867" });
    expect(parseYearValue("1850-1900")).toEqual({ op: "between", value: "1850", value2: "1900" });
    expect(parseYearValue("1850..1900")).toEqual({ op: "between", value: "1850", value2: "1900" });
    expect(parseYearValue(">1990")).toEqual({ op: "gt", value: "1990" });
    expect(parseYearValue("<=1900")).toEqual({ op: "lte", value: "1900" });
    expect(parseYearValue("XXI")).toEqual({ op: "between", value: "2001", value2: "2100" });
    expect(parseYearValue("XVIII-XIX")).toEqual({ op: "between", value: "1701", value2: "1900" });
    expect(parseYearValue("siglo XIX")).toEqual({ op: "between", value: "1801", value2: "1900" });
    expect(parseYearValue("19", true)).toEqual({ op: "between", value: "1801", value2: "1900" });
    expect(parseYearValue("hola")).toBeNull();
    expect(parseYearValue("MM")).toBeNull(); // 2000 no es un siglo
  });

  it("alias, negación, comillas y campo con valor", () => {
    expect(parseQuery("-@autor: Engels").spec.conditions[0]).toMatchObject({ field: "author", negate: true });
    expect(parseQuery("-ideología").spec.conditions[0]).toMatchObject({ field: "*", negate: true });
    expect(parseQuery('@título: "El Capital"').spec.conditions[0]).toMatchObject({ field: "title", op: "equals", value: "El Capital" });
    expect(parseQuery("@editorial: Akal").spec.conditions[0].field).toBe("publisher");
    expect(parseQuery("@publicationTitle: Nature").spec.conditions[0].field).toBe("publicationTitle");
    expect(parseQuery("@extra:").spec.conditions[0]).toMatchObject({ op: "empty", negate: true });
    expect(parseQuery("-@extra:").spec.conditions[0]).toMatchObject({ op: "empty", negate: false });
    expect(parseQuery("@volumen: >2").spec.conditions[0]).toMatchObject({ field: "volume", op: "gt", value: "2" });
    expect(parseQuery("@fecha: 2000-01-01..2010-12-31").spec.conditions[0]).toMatchObject({ field: "date", op: "between" });
  });

  it("vacío y separadores sobrantes no generan condiciones", () => {
    expect(parseQuery("").spec.conditions).toEqual([]);
    expect(parseQuery(" | | ").spec.conditions).toEqual([]);
  });

  it("avisa de campos inexistentes y de años ilegibles", () => {
    const known = knownFieldNames(index);
    expect(parseQuery("@autor: Marx | @editorial: Akal", "and", known).warnings).toEqual([]);
    expect(parseQuery("@inventado: x", "and", known).warnings[0]).toContain("inventado");
    expect(parseQuery("@año: mucho").warnings[0]).toContain("mucho");
  });
});

describe("búsqueda sobre los ítems", () => {
  it("tu ejemplo con Y: Marx, «ideología» y siglo XIX", () => {
    expect(search("@autor: Marx | ideología | @año: XIX")).toEqual(["IDEOLOG1"]);
  });
  it("el mismo ejemplo con O (interruptor alternativo)", () => {
    expect(search("@autor: Marx | ideología | @año: XIX", "or")).toEqual(["CAPITAL1", "FENOMEN1", "IDEOLOG1"]);
  });
  it("ignora tildes y mayúsculas", () => {
    expect(search("IDEOLOGIA")).toEqual(["IDEOLOG1"]);
    expect(search("@etiqueta: ECONOMIA")).toEqual(["CAPITAL1"]);
  });
  it("campos multivalor, tipos de creador y campos reales de Zotero", () => {
    expect(search("@autor: Engels")).toEqual(["IDEOLOG1"]);
    expect(search("@autor: Friedrich Engels")).toEqual(["IDEOLOG1"]);
    expect(search("@autor: Engels, Friedrich")).toEqual(["IDEOLOG1"]);
    expect(search("@traductor: Bergés")).toEqual(["PSICOPO1"]);
    expect(search("@autor: Bergés")).toEqual([]); // el traductor no es autor
    expect(search("@creador: Bergés")).toEqual(["PSICOPO1"]);
    expect(search("@editorial: akal")).toEqual(["CAPITAL1"]);
    expect(search("@PUBLISHER: akal")).toEqual(["CAPITAL1"]);
  });
  it("años, rangos y comparaciones", () => {
    expect(search("@año: >1990")).toEqual(["PSICOPO1"]);
    expect(search("@año: 1800-1850")).toEqual(["FENOMEN1", "IDEOLOG1"]);
    expect(search("@año: XVIII")).toEqual(["CRITICA1"]);
    expect(search("@siglo: XXI")).toEqual(["PSICOPO1"]);
  });
  it("fechas ISO con rango y comparación numérica de otros campos", () => {
    expect(search("@fecha: 1800-01-01..1850-12-31")).toEqual(["FENOMEN1", "IDEOLOG1"]);
    expect(search("@volumen: >2")).toEqual(["PSICOPO1"]);
  });
  it("negación, exactitud y campo con valor", () => {
    expect(search("-@autor: Marx")).toEqual(["CRITICA1", "FENOMEN1", "PSICOPO1", "SINFECH1"]);
    expect(search('@título: "el capital"')).toEqual(["CAPITAL1"]);
    expect(search("@título: capital")).toEqual(["CAPITAL1"]);
    expect(search("@año:")).toEqual(["CAPITAL1", "CRITICA1", "FENOMEN1", "IDEOLOG1", "PSICOPO1"]);
    expect(search("-@año:")).toEqual(["SINFECH1"]);
  });
  it("colecciones por nombre y consulta vacía", () => {
    expect(search("@colección: marx")).toEqual(["CAPITAL1", "IDEOLOG1"]);
    expect(search("")).toHaveLength(6);
  });
  it("campo inexistente no coincide con nada", () => {
    expect(search("@inventado: x")).toEqual([]);
  });
  it("itemMatches sin condiciones devuelve true", () => {
    expect(itemMatches(index.items.get("CAPITAL1")!, { mode: "and", conditions: [] }, ctx)).toBe(true);
  });
});

describe("colecciones como límite", () => {
  const avail = (collections: string[], sub: boolean, q = "") =>
    keys(availableItems(index, { collections, includeSubcollections: sub, query: parseQuery(q).spec }));
  it("con y sin subcolecciones", () => {
    expect(avail(["COLHEGEL"], true)).toEqual(["CRITICA1", "FENOMEN1"]);
    expect(avail(["COLHEGEL"], false)).toEqual(["FENOMEN1"]);
  });
  it("varias colecciones y combinación con la búsqueda", () => {
    expect(avail(["COLMARX", "COLHEGEL"], false)).toEqual(["CAPITAL1", "FENOMEN1", "IDEOLOG1"]);
    expect(avail(["COLHEGEL"], true, "@año: <1800")).toEqual(["CRITICA1"]);
  });
  it("sin colecciones elegidas, toda la biblioteca", () => {
    expect(avail([], true)).toHaveLength(6);
  });
});

describe("panel de etiquetas", () => {
  it("sin ítems seleccionados no muestra etiquetas", () => {
    const p = tagPanel(index, [], ["Tomo I"]);
    expect(p.tags).toEqual([]);
    expect(p.selected.size).toBe(0);
  });
  it("solo las etiquetas de las anotaciones de los ítems seleccionados, con recuento", () => {
    expect(tagPanel(index, ["CAPITAL1"], []).tags).toEqual([
      { tag: "mercancía", count: 1 },
      { tag: "Tomo I", count: 2 },
    ]);
    const both = tagPanel(index, ["CAPITAL1", "IDEOLOG1"], []).tags;
    expect(both.find((t) => t.tag === "mercancía")!.count).toBe(2);
    expect(both.map((t) => t.tag)).toContain("Feuerbach");
  });
  it("una etiqueta elegida que deja de estar disponible se deselecciona", () => {
    expect([...tagPanel(index, ["CAPITAL1"], ["Feuerbach", "Tomo I"]).selected]).toEqual(["Tomo I"]);
  });
  it("coincidencia total (Y) o parcial (O)", () => {
    const a1 = index.annotations.get("ANNA0001")!;
    const a2 = index.annotations.get("ANNA0002")!;
    const sel = new Set(["Tomo I", "mercancía"]);
    expect(annotationMatchesTags(a1, sel, "all")).toBe(true);
    expect(annotationMatchesTags(a2, sel, "all")).toBe(false);
    expect(annotationMatchesTags(a2, sel, "any")).toBe(true);
    expect(annotationMatchesTags(index.annotations.get("ANNA0003")!, sel, "any")).toBe(false);
    expect(annotationMatchesTags(index.annotations.get("ANNA0003")!, new Set(), "all")).toBe(true);
  });
});

describe("resultado (reglas acordadas)", () => {
  const counts = (r: ReturnType<typeof computeResults>) => Object.fromEntries([...r.annotations].map(([k, v]) => [k, v.length]));

  it("sin ítems seleccionados no hay nada, aunque haya etiquetas", () => {
    const r = computeResults(index, [], new Set(["Tomo I"]), "any");
    expect(r.items).toEqual([]);
    expect(flattenAnnotations(r)).toEqual([]);
  });
  it("solo con ítems: metadata de todos y todas sus anotaciones", () => {
    const r = computeResults(index, ["CAPITAL1", "FENOMEN1"], new Set(), "all");
    expect(r.items.map((i) => i.key)).toEqual(["CAPITAL1", "FENOMEN1"]);
    expect(counts(r)).toEqual({ CAPITAL1: 3, FENOMEN1: 0 }); // un ítem sin anotaciones sigue mostrando su metadata
  });
  it("con ítems y etiquetas: metadata de todos y solo las anotaciones que coinciden", () => {
    const r = computeResults(index, ["CAPITAL1", "FENOMEN1"], new Set(["Tomo I"]), "any");
    expect(r.items.map((i) => i.key)).toEqual(["CAPITAL1", "FENOMEN1"]);
    expect(counts(r)).toEqual({ CAPITAL1: 2, FENOMEN1: 0 });
    expect(r.allAnnotations.get("CAPITAL1")).toHaveLength(3);
  });
  it("con Y solo pasan las anotaciones que llevan todas las etiquetas", () => {
    const r = computeResults(index, ["CAPITAL1"], new Set(["Tomo I", "mercancía"]), "all");
    expect(flattenAnnotations(r).map((a) => a.key)).toEqual(["ANNA0001"]);
  });
  it("ignora claves inexistentes y repetidas", () => {
    const r = computeResults(index, ["NOEXISTE", "CAPITAL1", "CAPITAL1"], new Set(), "all");
    expect(r.items.map((i) => i.key)).toEqual(["CAPITAL1"]);
  });
});

describe("orden", () => {
  const all = [...index.items.values()];
  const order = (list: Array<{ key: string }>) => list.map((i) => i.key);
  it("por fecha: los ítems sin fecha van siempre al final", () => {
    expect(order(sortItems(all, "date", "asc"))).toEqual(["CRITICA1", "FENOMEN1", "IDEOLOG1", "CAPITAL1", "PSICOPO1", "SINFECH1"]);
    expect(order(sortItems(all, "date", "desc"))).toEqual(["PSICOPO1", "CAPITAL1", "IDEOLOG1", "FENOMEN1", "CRITICA1", "SINFECH1"]);
  });
  it("por autor, con desempate por título y sin autor al final", () => {
    expect(order(sortItems(all, "author"))).toEqual(["PSICOPO1", "FENOMEN1", "CRITICA1", "CAPITAL1", "IDEOLOG1", "SINFECH1"]);
  });
  it("por título ignorando tildes", () => {
    expect(sortItems(all, "title")[0].title).toBe("Crítica de la razón pura");
  });
  it("anotaciones por color en el orden de la paleta de Zotero", () => {
    const anns = [...index.annotations.values()];
    const sorted = sortAnnotations(index, anns, "color").map((a) => a.colorCategory);
    expect(sorted).toEqual(["yellow", "yellow", "red", "green", "purple"]);
  });
  it("por página: orden de lectura; en descendente se invierte dentro de cada ítem", () => {
    const anns = [...index.annotationsOf("CAPITAL1"), ...index.annotationsOf("IDEOLOG1")];
    expect(sortAnnotations(index, anns, "page").map((a) => a.key)).toEqual(["ANNA0001", "ANNA0002", "ANNA0003", "ANNB0001", "ANNB0002"]);
    expect(sortAnnotations(index, anns, "page", "desc").map((a) => a.key)).toEqual(["ANNA0003", "ANNA0002", "ANNA0001", "ANNB0002", "ANNB0001"]);
  });
});

describe("agrupación", () => {
  const all = [...index.items.values()];
  it("ítems por año, con «sin fecha» al final", () => {
    expect(groupItems(index, all, "year").map((g) => g.label)).toEqual(["1781", "1807", "1846", "1867", "2014", "(sin fecha)"]);
  });
  it("ítems por colección", () => {
    const g = groupItems(index, all, "collection");
    expect(g.map((x) => x.label)).toEqual(["Hegel", "Hegel sub", "Marx", "(sin colección)"]);
    expect(g.find((x) => x.label === "Marx")!.entries.map((i) => i.key).sort()).toEqual(["CAPITAL1", "IDEOLOG1"]);
  });
  it("ítems por autor y por tipo", () => {
    expect(groupItems(index, all, "author").map((g) => g.label)).toEqual(["Han", "Hegel", "Kant", "Marx", "(sin autor)"]);
    expect(groupItems(index, all, "itemType").map((g) => g.label)).toEqual(["Capítulo de libro"]);
  });
  it("sin agrupar devuelve un solo grupo", () => {
    expect(groupItems(index, all, "none")).toHaveLength(1);
  });
  it("anotaciones por etiqueta: una anotación aparece en cada una de sus etiquetas", () => {
    const anns = [...index.annotations.values()];
    const g = groupAnnotations(index, anns, "tag");
    expect(g.map((x) => x.label)).toEqual(["Feuerbach", "mercancía", "Tomo I", "(sin etiqueta)"]);
    expect(g.find((x) => x.label === "mercancía")!.entries.map((a) => a.key).sort()).toEqual(["ANNA0001", "ANNB0001"]);
    expect(g.find((x) => x.label === "(sin etiqueta)")!.entries).toHaveLength(2);
  });
  it("anotaciones por color y por ítem", () => {
    const anns = [...index.annotations.values()];
    expect(groupAnnotations(index, anns, "color").map((g) => g.label)).toEqual(["yellow", "red", "green", "purple"]);
    expect(groupAnnotations(index, anns, "item").map((g) => g.label)).toEqual(["El Capital", "La ideología alemana"]);
  });
});

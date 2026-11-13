// @vitest-environment jsdom
import moment from "moment";
import { beforeAll, describe, expect, it } from "vitest";
import { buildContentFilter, contentMatches, contentTerms, parseContentQuery, plainText } from "../src/filter/content";
import { annotationBase, tagCounts, tagPanel } from "../src/filter/selection";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { attachmentAsItem } from "../src/model/attachmentItem";
import { buildOutput, type BuildDeps } from "../src/output/build";
import { DEFAULT_IMAGE_NAME_TEMPLATE, itemContext, standaloneAnnotationContext, type ContextOptions } from "../src/template/context";
import { TemplateEngine, type MomentFn } from "../src/template/engine";
import { ROW_FORMATS, resolveRowFormat, oneLine } from "../src/template/rowFormats";
import { ATTACHMENTS_SECTION, SELECTED_SECTION, buildListRows } from "../src/ui/listRows";
import { findRanges, highlightTerms } from "../src/ui/highlight";
import { installObsidianDom } from "./obsidianDom";
import { defaultViewState, derive, type ViewState } from "../src/ui/state";
import { annotation, attachment, collection, item } from "./fixtures";

beforeAll(() => installObsidianDom(window as unknown as Window & typeof globalThis));

const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });
const tag = (...t: string[]) => t.map((x) => ({ tag: x, type: 0 }));
const state = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultViewState(), ...over });

/**
 * Dos ítems con anotaciones, un PDF suelto en la colección COL1 y un adjunto con
 * el padre ausente (los «adjuntos sin contenedor»).
 */
const index = LibraryIndex.fromRaw({
  entities: [
    item("ITEMAAAA", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867", collections: ["COL1"] }, { parsedDate: "1867" }),
    item("ITEMBBBB", { title: "Fenomenología", creators: [au("Georg", "Hegel")], date: "1807" }, { parsedDate: "1807" }),
    attachment("ATTAAAAA", "ITEMAAAA", { filename: "capital.pdf" }),
    attachment("ATTBBBBB", "ITEMBBBB", { filename: "fenomenologia.pdf" }),
    attachment("SOLO0001", null, { filename: "suelto.pdf", title: "PDF suelto", collections: ["COL1"] }),
    attachment("ORPH0001", "FALTAPAD", { filename: "huerfano.pdf", title: "Huérfano" }),
    annotation("A1AAAAAA", "ATTAAAAA", { annotationText: "La clase obrera lucha", annotationComment: "<i>proletariado</i>", annotationSortIndex: "00001|000001|00001", tags: tag("x", "y") }),
    annotation("A2AAAAAA", "ATTAAAAA", { annotationText: "Burguesía y capital", annotationComment: "", annotationSortIndex: "00002|000001|00001", tags: tag("x") }),
    annotation("A3AAAAAA", "ATTAAAAA", { annotationText: "otra", annotationComment: "", annotationSortIndex: "00003|000001|00001", tags: tag("y", "z") }),
    annotation("B1BBBBBB", "ATTBBBBB", { annotationText: "Espíritu absoluto", annotationComment: "", tags: tag("z") }),
    annotation("S1SSSSSS", "SOLO0001", { annotationText: "nota del pdf suelto", annotationComment: "", tags: tag("x") }),
    annotation("O1OOOOOO", "ORPH0001", { annotationText: "del huérfano", annotationComment: "", tags: tag("w") }),
  ],
  collections: [collection("COL1", "Colección uno")],
  libraryVersion: 1,
  total: 0,
  truncated: false,
});

describe("búsqueda de contenido", () => {
  it("palabras separadas = todas deben aparecer; | separa alternativas", () => {
    expect(parseContentQuery("clase obrera | proletariado")).toEqual([["clase", "obrera"], ["proletariado"]]);
    expect(parseContentQuery("  | ")).toEqual([]);
    expect(contentMatches("La clase obrera lucha", parseContentQuery("obrera clase"))).toBe(true); // el orden no importa
    expect(contentMatches("La clase media", parseContentQuery("clase obrera"))).toBe(false);
    expect(contentMatches("El proletariado", parseContentQuery("clase obrera | proletariado"))).toBe(true);
  });

  it("no distingue mayúsculas ni tildes", () => {
    expect(contentMatches("Espíritu ABSOLUTO", parseContentQuery("espiritu absoluto"))).toBe(true);
    expect(contentMatches("espiritu", parseContentQuery("ESPÍRITU"))).toBe(true);
  });

  it("ignora las etiquetas HTML del comentario", () => {
    expect(plainText("Marx toma la <b>mercancía</b> &amp; <i>forma</i>")).toBe("Marx toma la mercancía & forma");
    expect(contentMatches(plainText("<i>clase</i>"), parseContentQuery("clase"))).toBe(true);
    expect(contentMatches(plainText("a<sup>[4]</sup>b"), parseContentQuery("sup"))).toBe(false);
  });

  it("el ámbito limita dónde se busca", () => {
    const a1 = index.annotations.get("A1AAAAAA")!;
    expect(buildContentFilter("proletariado", "comment")!.matches(a1)).toBe(true);
    expect(buildContentFilter("proletariado", "text")!.matches(a1)).toBe(false);
    expect(buildContentFilter("clase", "text")!.matches(a1)).toBe(true);
    expect(buildContentFilter("clase", "comment")!.matches(a1)).toBe(false);
    expect(buildContentFilter("clase proletariado", "both")!.matches(a1)).toBe(true); // una palabra en cada parte
    expect(buildContentFilter("  ", "both")).toBeNull();
  });

  it("filtra los resultados, las etiquetas y la salida con el mismo canal", () => {
    const d = derive(index, state({ selectedItems: ["ITEMAAAA", "ITEMBBBB"], contentSearch: "clase obrera | espiritu" }));
    expect(d.annotations.map((a) => a.key).sort()).toEqual(["A1AAAAAA", "B1BBBBBB"]);
    expect(d.tags.tags.map((t) => t.tag)).toEqual(["x", "y", "z"]); // solo las de las anotaciones que pasan
    expect(d.tags.tags.find((t) => t.tag === "x")!.count).toBe(1);
    // la metadata de todos los ítems sigue ahí
    expect(d.results.items).toHaveLength(2);
    expect(d.results.allAnnotations.get("ITEMAAAA")).toHaveLength(3);
  });

  it("una etiqueta elegida que deja de estar disponible se descarta", () => {
    const d = derive(index, state({ selectedItems: ["ITEMAAAA", "ITEMBBBB"], selectedTags: ["x"], contentSearch: "espiritu" }));
    expect([...d.selectedTags]).toEqual([]);
    expect(d.annotations.map((a) => a.key)).toEqual(["B1BBBBBB"]);
  });
});

describe("resaltado de coincidencias", () => {
  it("encuentra rangos sin distinguir tildes ni mayúsculas, uniendo los que se solapan", () => {
    expect(findRanges("Espíritu absoluto", ["espiritu"])).toEqual([[0, 8]]);
    expect(findRanges("clase obrera clase", ["clase"])).toEqual([[0, 5], [13, 18]]);
    expect(findRanges("abcdef", ["abc", "cde"])).toEqual([[0, 5]]);
    expect(findRanges("nada", ["zzz"])).toEqual([]);
  });

  it("envuelve solo nodos de texto y conserva enlaces e imágenes", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p>La <a href="x">clase</a> obrera <img alt="clase"> y la CLASE</p>';
    const n = highlightTerms(root, contentTerms(parseContentQuery("clase")));
    expect(n).toBe(2);
    expect([...root.querySelectorAll("mark.zl-hit")].map((m) => m.textContent)).toEqual(["clase", "CLASE"]);
    expect(root.querySelector("a")!.getAttribute("href")).toBe("x");
    expect(root.querySelector("img")!.getAttribute("alt")).toBe("clase");
    expect(root.textContent).toBe("La clase obrera  y la CLASE");
  });
});

describe("contadores de etiquetas", () => {
  const base = annotationBase(index, ["ITEMAAAA", "ITEMBBBB"]); // A1 (x,y), A2 (x), A3 (y,z), B1 (z)
  const counts = (t: ReturnType<typeof tagCounts>) => Object.fromEntries(t.map((e) => [e.tag, e.count]));

  it("sin etiquetas elegidas, el total de cada etiqueta", () => {
    expect(counts(tagCounts(base, new Set(), "all"))).toEqual({ x: 2, y: 2, z: 2 });
    expect(counts(tagCounts(base, new Set(), "any"))).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("con Y baja al restringir y se ocultan las de cero", () => {
    expect(counts(tagCounts(base, new Set(["x"]), "all"))).toEqual({ x: 2, y: 1 }); // z no aparece: 0
    expect(counts(tagCounts(base, new Set(["x", "y"]), "all"))).toEqual({ x: 1, y: 1 });
  });

  it("con O el contador no cambia: ni restringe ni agrega", () => {
    expect(counts(tagCounts(base, new Set(["x"]), "any"))).toEqual({ x: 2, y: 2, z: 2 });
    expect(counts(tagCounts(base, new Set(["x", "z"]), "any"))).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("una etiqueta elegida siempre se muestra, aunque su combinación dé 0", () => {
    const r = counts(tagCounts(base, new Set(["x", "z"]), "all")); // ninguna anotación tiene x y z
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
  });

  it("tagPanel respeta el modo y descarta las etiquetas que no existen", () => {
    const p = tagPanel(index, ["ITEMAAAA", "ITEMBBBB"], ["x", "fantasma"], { match: "any" });
    expect([...p.selected]).toEqual(["x"]);
    expect(counts(p.tags)).toEqual({ x: 2, y: 2, z: 2 });
  });
});

describe("adjuntos sin contenedor", () => {
  it("el índice los ve como ítems sintéticos: sueltos y con el padre ausente", () => {
    expect([...index.attachmentItems.keys()].sort()).toEqual(["ORPH0001", "SOLO0001"]);
    const s = index.attachmentItems.get("SOLO0001")!;
    expect(s.fromAttachment).toBe(true);
    expect(s.title).toBe("suelto.pdf");
    expect(s.creators).toEqual([]);
    expect(s.collections).toEqual(["COL1"]);
    expect(attachmentAsItem(index.attachments.get("ORPH0001")!).title).toBe("huerfano.pdf");
    expect(index.items.has("SOLO0001")).toBe(false); // los ítems reales no cambian
    expect(index.stats().items).toBe(2);
  });

  it("itemKeyOf devuelve el adjunto cuando no hay ítem (también con el padre ausente)", () => {
    expect(index.itemKeyOf(index.annotations.get("S1SSSSSS")!)).toBe("SOLO0001");
    expect(index.itemKeyOf(index.annotations.get("O1OOOOOO")!)).toBe("ORPH0001");
    expect(index.itemKeyOf(index.annotations.get("A1AAAAAA")!)).toBe("ITEMAAAA");
  });

  it("están disponibles al final, ordenados por nombre, y no alteran el orden de los ítems", () => {
    const d = derive(index, state());
    expect(d.available.map((i) => i.key)).toEqual(["ITEMBBBB", "ITEMAAAA", "ORPH0001", "SOLO0001"]); // por autor: Hegel, Marx; luego huérfano y suelto
    expect(d.listAttachments.map((i) => i.key)).toEqual(["ORPH0001", "SOLO0001"]); // huerfano.pdf < suelto.pdf
    expect(d.listGroups.flatMap((g) => g.entries).every((i) => !i.fromAttachment)).toBe(true);
  });

  it("la colección limita también a los adjuntos que están en ella", () => {
    const d = derive(index, state({ collections: ["COL1"] }));
    expect(d.available.map((i) => i.key).sort()).toEqual(["ITEMAAAA", "SOLO0001"]);
  });

  it("la búsqueda actúa sobre su nombre; un campo de autor los excluye", () => {
    expect(derive(index, state({ searchText: "suelto" })).available.map((i) => i.key)).toEqual(["SOLO0001"]);
    expect(derive(index, state({ searchText: "@autor: Marx" })).available.map((i) => i.key)).toEqual(["ITEMAAAA"]);
  });

  it("seleccionarlos aporta sus anotaciones a las etiquetas y a los resultados", () => {
    const d = derive(index, state({ selectedItems: ["SOLO0001", "ORPH0001"] }));
    expect(d.selectedItems).toEqual(["ORPH0001", "SOLO0001"]);
    expect(d.tags.tags.map((t) => t.tag)).toEqual(["w", "x"]);
    expect(d.results.items.map((i) => i.key).sort()).toEqual(["ORPH0001", "SOLO0001"]);
    expect(d.annotations.map((a) => a.key).sort()).toEqual(["O1OOOOOO", "S1SSSSSS"]);
  });

  it("las plantillas reciben el nombre del archivo como título, sin autores", () => {
    const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
    const opts: ContextOptions = { dataDir: "C:/Z", imagesFolder: "img", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) };
    const ctx = standaloneAnnotationContext(index, index.annotations.get("S1SSSSSS")!, opts, 1);
    expect(ctx.title).toBe("suelto.pdf");
    expect(ctx.authors).toBe("");
    const ictx = itemContext(index, index.attachmentItems.get("SOLO0001")!, [], [], opts);
    expect(ictx.title).toBe("suelto.pdf");
    expect((ictx.attachments as unknown[]).length).toBe(1);
    expect(ictx.itemType).toBe("attachment");
  });

  it("la salida «Metadata + anotaciones» y «Solo anotaciones» los incluyen; la bibliografía los omite con aviso", async () => {
    const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
    const opts: ContextOptions = { dataDir: "C:/Z", imagesFolder: "img", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) };
    const asked: string[][] = [];
    const deps: BuildDeps = {
      index, engine, templates: new Map(), opts,
      settings: { defaultTemplates: { full: "", meta: "", annotations: "", bibliography: "", link: "" }, defaultStyle: "apa", stripFrontmatterMulti: true, groupHeaders: true },
      fetchBibliography: async (keys) => (asked.push(keys), { entries: keys.map((k) => `Entrada ${k}`), failed: [] }),
    };
    const d = derive(index, state({ selectedItems: ["ITEMAAAA", "SOLO0001"] }));
    const full = await buildOutput(d, { kind: "full", template: "", style: "" }, { type: "all" }, deps);
    expect(full.text).toContain("suelto.pdf");
    expect(full.annotations).toBe(4); // A1, A2, A3 y S1
    const ann = await buildOutput(d, { kind: "annotations", template: "", style: "" }, { type: "all" }, deps);
    expect(ann.text).toContain("nota del pdf suelto");
    const bib = await buildOutput(d, { kind: "bibliography", template: "", style: "" }, { type: "all" }, deps);
    expect(asked).toEqual([["ITEMAAAA"]]);
    expect(bib.warnings.join(" ")).toContain("1 adjunto(s) sin contenedor");
  });
});

describe("filas de la lista", () => {
  const rowsOf = (over: Partial<ViewState> = {}, collapsed: string[] = []) => buildListRows(derive(index, state(over)), new Set(collapsed));
  const kinds = (rows: ReturnType<typeof rowsOf>) => rows.map((r) => (r.type === "header" ? `H:${r.label}` : `${r.section ? "S" : "-"}:${r.item.key}`));

  it("sin selección ni agrupación: ítems en orden y «Adjuntos sin contenedor» al final", () => {
    expect(kinds(rowsOf())).toEqual(["-:ITEMBBBB", "-:ITEMAAAA", "H:Adjuntos sin contenedor", "S:ORPH0001", "S:SOLO0001"]); // por autor: Hegel, Marx
  });

  it("los seleccionados suben arriba de todo y siguen apareciendo en su sitio", () => {
    const rows = rowsOf({ selectedItems: ["ITEMBBBB", "SOLO0001"] });
    expect(kinds(rows)).toEqual(["H:Seleccionados", "S:ITEMBBBB", "S:SOLO0001", "-:ITEMBBBB", "-:ITEMAAAA", "H:Adjuntos sin contenedor", "S:ORPH0001", "S:SOLO0001"]);
    const header = rows[0];
    expect(header.type === "header" && header.count).toBe(2);
  });

  it("también en cada grupo cuando la lista está agrupada", () => {
    const rows = rowsOf({ selectedItems: ["ITEMAAAA"], listGroup: "year" });
    const labels = kinds(rows);
    expect(labels[0]).toBe("H:Seleccionados");
    expect(labels).toContain("H:1807");
    expect(labels).toContain("H:1867");
    expect(labels.filter((l) => l.endsWith("ITEMAAAA"))).toHaveLength(2); // arriba y en su grupo
    expect(labels[labels.length - 3]).toBe("H:Adjuntos sin contenedor");
  });

  it("las secciones se pliegan: su contenido desaparece pero la cabecera queda", () => {
    const rows = rowsOf({ selectedItems: ["ITEMAAAA"], listGroup: "year" }, [SELECTED_SECTION, ATTACHMENTS_SECTION, "group:1807"]);
    const labels = kinds(rows);
    expect(labels).toEqual(["H:Seleccionados", "H:1807", "H:1867", "S:ITEMAAAA", "H:Adjuntos sin contenedor"]);
    expect(rows.filter((r) => r.type === "header").map((r) => r.type === "header" && r.collapsed)).toEqual([true, true, false, true]);
  });

  it("empieza todo desplegado", () => {
    expect(rowsOf({ selectedItems: ["ITEMAAAA"] }).filter((r) => r.type === "header").every((r) => r.type === "header" && !r.collapsed)).toBe(true);
  });
});

describe("orden y agrupación de la lista, independientes de los de resultados", () => {
  it("el orden de la lista no cambia el de los resultados", () => {
    const sel = ["ITEMAAAA", "ITEMBBBB"];
    const a = derive(index, state({ selectedItems: sel, listSort: { key: "title", dir: "asc" }, itemSort: { key: "author", dir: "asc" } }));
    const b = derive(index, state({ selectedItems: sel, listSort: { key: "title", dir: "desc" }, itemSort: { key: "author", dir: "asc" } }));
    expect(a.available.filter((i) => !i.fromAttachment).map((i) => i.key)).toEqual(["ITEMAAAA", "ITEMBBBB"]); // El Capital < Fenomenología
    expect(b.available.filter((i) => !i.fromAttachment).map((i) => i.key)).toEqual(["ITEMBBBB", "ITEMAAAA"]);
    expect(a.results.items.map((i) => i.key)).toEqual(["ITEMBBBB", "ITEMAAAA"]); // Hegel < Marx
    expect(b.results.items.map((i) => i.key)).toEqual(["ITEMBBBB", "ITEMAAAA"]);
  });

  it("el orden de resultados no cambia el de la lista", () => {
    const x = derive(index, state({ itemSort: { key: "author", dir: "asc" }, listSort: { key: "date", dir: "asc" } }));
    const y = derive(index, state({ itemSort: { key: "author", dir: "desc" }, listSort: { key: "date", dir: "asc" } }));
    expect(x.available.map((i) => i.key)).toEqual(y.available.map((i) => i.key));
  });

  it("la agrupación de la lista es propia", () => {
    const d = derive(index, state({ listGroup: "collection", itemGroup: "none" }));
    expect(d.listGroups.map((g) => g.label)).toEqual(["Colección uno", "(sin colección)"]);
    expect(d.itemGroups).toHaveLength(1);
    expect(d.itemGroups[0].label).toBe("");
  });
});

describe("formato de fila", () => {
  const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
  const opts: ContextOptions = { dataDir: "C:/Z", imagesFolder: "img", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) };
  const render = (source: string, key = "ITEMAAAA") => oneLine(engine.render(source, itemContext(index, index.items.get(key)!, [], [], opts)));

  it("los formatos incluidos producen una sola línea con los datos del ítem", () => {
    const byId = Object.fromEntries(ROW_FORMATS.map((f) => [f.id, f.source]));
    expect(render(byId["author-year-title"])).toBe("Marx (1867) — El Capital");
    expect(render(byId["authors-year-title"])).toBe("Marx (1867) — El Capital");
    expect(render(byId["author-title"])).toBe("Marx — El Capital");
    expect(render(byId["title-year"])).toBe("El Capital (1867)");
    expect(render(byId["title"])).toBe("El Capital");
    expect(render(byId["type-author-title"])).toBe("Capítulo de libro · Marx · El Capital");
  });

  it("sin autor o sin año usa «s. a.» y «s. f.»", () => {
    const sin = LibraryIndex.fromRaw({ entities: [item("SINAUTOR", { title: "Anónimo", creators: [], date: "" }, { parsedDate: undefined })], collections: [], libraryVersion: 1, total: 0, truncated: false });
    const out = oneLine(engine.render(ROW_FORMATS[0].source, itemContext(sin, sin.items.get("SINAUTOR")!, [], [], opts)));
    expect(out).toBe("s. a. (s. f.) — Anónimo");
  });

  it("una plantilla propia usa cualquier campo y su salida se reduce a una línea", () => {
    expect(render("{{ title }}\n  — {{ publisher }}\n{{ ISBN }}")).toBe("El Capital — Siglo Veintiuno 978-84-323-1592-3");
  });

  it("se resuelve: elegido > ajustes > incluido, y avisa si la plantilla no existe", () => {
    const templates = new Map([["filas/mia.md", "{{ title }}"]]);
    expect(resolveRowFormat("", "", templates).name).toBe("builtin:author-year-title");
    expect(resolveRowFormat("", "builtin:title", templates).name).toBe("builtin:title");
    expect(resolveRowFormat("builtin:title-year", "builtin:title", templates).name).toBe("builtin:title-year");
    expect(resolveRowFormat("filas/mia.md", "", templates)).toEqual({ name: "filas/mia.md", source: "{{ title }}" });
    const missing = resolveRowFormat("filas/borrada.md", "", templates);
    expect(missing.missing).toBe("filas/borrada.md");
    expect(missing.name).toBe("builtin:author-year-title");
    expect(resolveRowFormat("builtin:inexistente", "", templates).missing).toBe("builtin:inexistente");
  });

  it("es independiente de las plantillas de ítem: usa su propio ajuste", () => {
    // el formato de fila no se toma de defaultItemRender: se resuelve solo con rowFormat y defaultRowFormat
    const templates = new Map([["render/item.md", "ITEM {{ title }}"]]);
    expect(resolveRowFormat("", "", templates).source).toBe(ROW_FORMATS[0].source);
  });
});

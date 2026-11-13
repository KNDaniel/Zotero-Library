import moment from "moment";
import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { DEFAULT_ANNOTATION_RENDER, DEFAULT_ITEM_RENDER } from "../src/template/defaults";
import { DEFAULT_IMAGE_NAME_TEMPLATE, itemContext, standaloneAnnotationContext, type ContextOptions } from "../src/template/context";
import { TemplateEngine, type MomentFn } from "../src/template/engine";
import { stripFrontmatter } from "../src/markdown";
import { previewImages, toFileUrl } from "../src/ui/markdown";
import { defaultViewState, derive, isCompleteCondition, persistableState, restoreState, toggleInList, visibleTags, type ViewState } from "../src/ui/state";
import { annotation, attachment, collection, item } from "./fixtures";

const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });
const index = LibraryIndex.fromRaw({
  entities: [
    item("CAPITAL1", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867", collections: ["COLMARX"] }, { parsedDate: "1867" }),
    item("FENOMEN1", { title: "Fenomenología del espíritu", creators: [au("Georg", "Hegel")], date: "1807", collections: ["COLHEGEL"] }, { parsedDate: "1807" }),
    item("SINANOT1", { title: "Sin anotaciones", creators: [au("Ana", "Zeta")], date: "1999" }, { parsedDate: "1999" }),
    attachment("ATTCAP01", "CAPITAL1"),
    attachment("ATTIMG01", "FENOMEN1"),
    annotation("ANNA0001", "ATTCAP01", { annotationSortIndex: "00001|000001|00001", tags: [{ tag: "Tomo I", type: 0 }, { tag: "mercancía", type: 0 }] }),
    annotation("ANNA0002", "ATTCAP01", { annotationSortIndex: "00002|000001|00001", tags: [{ tag: "Tomo I", type: 0 }] }),
    annotation("ANNA0003", "ATTCAP01", { annotationSortIndex: "00003|000001|00001", tags: [] }),
    annotation("ANNF0001", "ATTIMG01", { annotationType: "image", annotationText: "", tags: [{ tag: "espíritu", type: 0 }], annotationPosition: JSON.stringify({ pageIndex: 3, rects: [[10.2, 20.6, 50, 60]] }) }),
  ],
  collections: [collection("COLMARX", "Marx"), collection("COLHEGEL", "Hegel")],
  libraryVersion: 1,
  total: 0,
  truncated: false,
});
const st = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultViewState(), ...over });
const keys = (l: Array<{ key: string }>) => l.map((x) => x.key);

describe("estado de la vista: derive", () => {
  it("sin ítems seleccionados no hay resultados ni etiquetas", () => {
    const d = derive(index, st());
    expect(keys(d.available)).toEqual(["FENOMEN1", "CAPITAL1", "SINANOT1"]); // por autor: Hegel, Marx, Zeta
    expect(d.available).toHaveLength(3);
    expect(d.results.items).toEqual([]);
    expect(d.tags.tags).toEqual([]);
    expect(d.annotations).toEqual([]);
  });

  it("con ítems seleccionados: metadata de todos y todas sus anotaciones", () => {
    const d = derive(index, st({ selectedItems: ["CAPITAL1", "SINANOT1"] }));
    expect(keys(d.results.items).sort()).toEqual(["CAPITAL1", "SINANOT1"]); // un ítem sin anotaciones también aparece
    expect(d.annotations).toHaveLength(3);
    expect(d.tags.tags.map((t) => t.tag)).toEqual(["mercancía", "Tomo I"]);
  });

  it("con etiquetas: metadata de todos y solo las anotaciones que coinciden", () => {
    const d = derive(index, st({ selectedItems: ["CAPITAL1", "FENOMEN1"], selectedTags: ["mercancía"], tagMatch: "any" }));
    expect(keys(d.results.items).sort()).toEqual(["CAPITAL1", "FENOMEN1"]);
    expect(d.annotations.map((a) => a.key)).toEqual(["ANNA0001"]);
  });

  it("la selección sobrevive a la búsqueda y a las colecciones; solo cambia qué se ve", () => {
    const d = derive(index, st({ selectedItems: ["CAPITAL1", "FENOMEN1"], searchText: "@autor: Hegel" }));
    expect(d.selectedItems).toEqual(["FENOMEN1", "CAPITAL1"]);
    expect(keys(d.selectedHidden)).toEqual(["CAPITAL1"]);
    expect(derive(index, st({ selectedItems: ["CAPITAL1"], collections: ["COLHEGEL"] })).selectedItems).toEqual(["CAPITAL1"]);
  });

  it("una etiqueta elegida que deja de estar disponible se descarta", () => {
    const d = derive(index, st({ selectedItems: ["CAPITAL1"], selectedTags: ["espíritu", "Tomo I"] }));
    expect([...d.selectedTags]).toEqual(["Tomo I"]);
    expect(d.annotations.map((a) => a.key)).toEqual(["ANNA0001", "ANNA0002"]);
  });

  it("coincidencia total (Y) frente a parcial (O)", () => {
    const base = { selectedItems: ["CAPITAL1"], selectedTags: ["Tomo I", "mercancía"] };
    expect(derive(index, st({ ...base, tagMatch: "all" })).annotations.map((a) => a.key)).toEqual(["ANNA0001"]);
    expect(derive(index, st({ ...base, tagMatch: "any" })).annotations.map((a) => a.key)).toEqual(["ANNA0001", "ANNA0002"]);
  });

  it("orden y agrupación de anotaciones y de ítems", () => {
    const d = derive(index, st({ selectedItems: ["CAPITAL1", "FENOMEN1"], annotationSort: { key: "page", dir: "desc" }, annotationGroup: "item", itemGroup: "year" }));
    // los grupos siguen el orden de los ítems (por autor: Hegel antes que Marx)
    expect(d.annotationGroups.map((g) => g.label)).toEqual(["Fenomenología del espíritu", "El Capital"]);
    expect(d.annotationGroups[1].entries.map((a) => a.key)).toEqual(["ANNA0003", "ANNA0002", "ANNA0001"]);
    expect(d.itemGroups.map((g) => g.label)).toEqual(["1807", "1867"]);
  });

  it("modo complejo: las filas incompletas se ignoran y Y/O es un único interruptor", () => {
    const conditions = [
      { field: "author", op: "contains" as const, value: "Marx", negate: false },
      { field: "year", op: "between" as const, value: "1800", negate: false }, // incompleta: falta value2
      { field: "title", op: "contains" as const, value: "", negate: false }, // incompleta
    ];
    expect(conditions.map(isCompleteCondition)).toEqual([true, false, false]);
    expect(keys(derive(index, st({ searchMode: "complex", complexConditions: conditions })).available)).toEqual(["CAPITAL1"]);
    const or = derive(index, st({ searchMode: "complex", combine: "or", complexConditions: [conditions[0], { field: "year", op: "lt", value: "1850", negate: false }] }));
    expect(keys(or.available).sort()).toEqual(["CAPITAL1", "FENOMEN1"]);
  });

  it("modo simple con avisos de campos desconocidos", () => {
    const d = derive(index, st({ searchText: "@inventado: x" }));
    expect(d.warnings[0]).toContain("inventado");
    expect(d.available).toEqual([]);
  });
});

describe("estado: persistencia y utilidades", () => {
  it("solo se guarda lo que no es selección", () => {
    const saved = persistableState(st({ selectedItems: ["A"], selectedTags: ["t"], tagSearch: "x", searchText: "Marx", mode: "annotation" }));
    expect(saved).not.toHaveProperty("selectedItems");
    expect(saved).not.toHaveProperty("selectedTags");
    expect(saved.searchText).toBe("Marx");
    const back = restoreState(saved);
    expect(back.selectedItems).toEqual([]);
    expect(back.mode).toBe("annotation");
    expect(restoreState(undefined)).toEqual(defaultViewState());
    expect(restoreState({ tagMatch: "any" }).includeSubcollections).toBe(true); // completa lo que falte
  });
  it("visibleTags: filtra sin tildes y pone primero las elegidas", () => {
    const panel = derive(index, st({ selectedItems: ["CAPITAL1", "FENOMEN1"] })).tags;
    expect(visibleTags(panel, new Set(), "ESPIRITU").map((t) => t.tag)).toEqual(["espíritu"]);
    const rows = visibleTags(panel, new Set(["Tomo I"]), "");
    expect(rows[0]).toMatchObject({ tag: "Tomo I", selected: true, count: 2 });
    expect(rows.map((r) => r.tag)).toEqual(["Tomo I", "espíritu", "mercancía"]);
  });
  it("restoreState completa las plantillas de salida que falten", () => {
    const back = restoreState({ outputTemplates: { full: "a.md" } as never });
    expect(back.outputTemplates).toEqual({ full: "a.md", meta: "", annotations: "", bibliography: "", link: "" });
  });
  it("toggleInList", () => {
    expect(toggleInList(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleInList(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("markdown de las tarjetas", () => {
  it("quita el frontmatter inicial y solo ese", () => {
    expect(stripFrontmatter("---\ntitulo: x\n---\n\nHola\n---\nno")).toBe("\nHola\n---\nno");
    expect(stripFrontmatter("Sin frontmatter")).toBe("Sin frontmatter");
    expect(stripFrontmatter("---\r\na: 1\r\n---\r\nTexto")).toBe("Texto");
  });
  it("URL de archivo para rutas de Windows y de Unix", () => {
    expect(toFileUrl("C:\\ZoteroSynthetic\\cache\\library\\K.png")).toBe("file:///C:/ZoteroSynthetic/cache/library/K.png");
    expect(toFileUrl("/home/u/Zotero dir/K.png")).toBe("file:///home/u/Zotero%20dir/K.png");
  });
  it("sustituye los embeds de imagen por la imagen de la caché, con su ancho", () => {
    const md = "> ![[Recursos/Img. Titulos/K-8-x98-y662.png|300]]  \nOtro ![[Recursos/Img. Titulos/K-8-x98-y662.png]] y ![[otra.png|10]]";
    const out = previewImages(md, [{ relativePath: "Recursos/Img. Titulos/K-8-x98-y662.png", absolutePath: "C:/Z/cache/library/ABC.png" }]);
    expect(out).toContain('<img src="file:///C:/Z/cache/library/ABC.png" width="300" alt="Imagen de anotación de Zotero">');
    expect(out).toContain('<img src="file:///C:/Z/cache/library/ABC.png" alt="Imagen de anotación de Zotero">');
    expect(out).toContain("![[otra.png|10]]"); // lo que no es una imagen conocida queda igual
    expect(previewImages(md, [{ relativePath: "", absolutePath: "x" }])).toBe(md);
  });
});

describe("plantillas de renderizado incluidas", () => {
  const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
  const opts: ContextOptions = { dataDir: "C:/Z", imagesFolder: "Img", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) };

  it("la de ítem muestra título, autor, año y los enlaces «Zotero» y «Local», sin el recuento", () => {
    const it0 = index.items.get("CAPITAL1")!;
    const all = index.annotationsOf("CAPITAL1");
    const md = engine.render(DEFAULT_ITEM_RENDER, itemContext(index, it0, all.slice(0, 1), all, opts));
    expect(md).toContain("**El Capital**");
    expect(md).toContain("Karl Marx (1867)");
    expect(md).toContain("[Zotero](zotero://open/library/items/ATTCAP01?page=1)"); // «Zotero» abre el PDF principal en la primera página
    expect(md).not.toContain("anotaciones"); // el recuento ya no va en la tarjeta
  });
  it("la de ítem no rompe con un ítem casi vacío", () => {
    const it0 = index.items.get("SINANOT1")!;
    const md = engine.render(DEFAULT_ITEM_RENDER, itemContext(index, it0, [], [], opts));
    expect(md).toContain("**Sin anotaciones**");
    expect(md).toContain("[Zotero](zotero://select/library/items/SINANOT1)"); // sin adjunto: selecciona el ítem
    expect(md).not.toContain("[Local]"); // y no hay enlace local
  });
  it("la de anotación muestra texto, comentario, cita y enlace; imágenes con su embed", () => {
    const a = index.annotations.get("ANNA0001")!;
    const md = engine.render(DEFAULT_ANNOTATION_RENDER, standaloneAnnotationContext(index, a, opts));
    expect(md).toContain("> texto subrayado");
    expect(md).toContain("comentario");
    expect(md).toContain("Karl Marx (1867), *El Capital*, [p. VIII](zotero://open/library/items/ATTCAP01?page=VIII&annotation=ANNA0001)");
    const img = engine.render(DEFAULT_ANNOTATION_RENDER, standaloneAnnotationContext(index, index.annotations.get("ANNF0001")!, opts));
    expect(img).toContain("![[Img/ATTIMG01-4-x10-y21.png|300]]");
    expect(img).not.toContain("> ");
  });
});

import moment from "moment";
import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { buildOutput, type BuildDeps, type OutputKind, type OutputRequest, type OutputScope, type OutputSettings } from "../src/output/build";
import { DEFAULT_IMAGE_NAME_TEMPLATE, type ContextOptions } from "../src/template/context";
import { TemplateEngine, type MomentFn } from "../src/template/engine";
import { defaultViewState, derive, persistableState, restoreState, type ViewState } from "../src/ui/state";
import { annotation, attachment, collection, item } from "./fixtures";

const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });
const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
const opts: ContextOptions = { dataDir: "C:/Z", imagesFolder: "Recursos/Img. Titulos", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) };
const settings: OutputSettings = { defaultTemplates: { full: "", meta: "", annotations: "", bibliography: "", link: "" }, defaultStyle: "apa", stripFrontmatterMulti: true, groupHeaders: true };
const req = (kind: OutputKind): OutputRequest => ({ kind, template: "", style: "" });
const state = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultViewState(), ...over });

const index = LibraryIndex.fromRaw({
  entities: [
    item("CAPITAL1", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867", collections: ["COLM"] }, { parsedDate: "1867" }),
    item("FENOMEN1", { title: "Fenomenología", creators: [au("Georg", "Hegel")], date: "1807", collections: ["COLH"] }, { parsedDate: "1807" }),
    attachment("ATTCAP01", "CAPITAL1"),
    attachment("ATTFEN01", "FENOMEN1"),
    annotation("ANNA0001", "ATTCAP01", { annotationSortIndex: "00001|0|0", tags: [{ tag: "Tomo I", type: 0 }], annotationText: "uno" }),
    annotation("ANNA0002", "ATTCAP01", { annotationSortIndex: "00002|0|0", tags: [{ tag: "mercancía", type: 0 }], annotationText: "dos" }),
    annotation("ANNF0001", "ATTFEN01", { annotationText: "tres" }),
  ],
  collections: [collection("COLM", "Marx"), collection("COLH", "Hegel")],
  libraryVersion: 1, total: 0, truncated: false,
});
const deps = (): BuildDeps => ({
  index, engine, templates: new Map(), opts, settings,
  fetchBibliography: async (keys) => ({ entries: keys.map((k) => `Entrada de ${k}`), failed: [] }),
});
const marked = (mode: "item" | "annotation", ids: string[]): OutputScope => ({ type: "marked", mode, items: mode === "item" ? ids : [], annotations: mode === "annotation" ? ids : [] });

describe("marcas: duran lo que dure la selección del ítem", () => {
  const base = { selectedItems: ["CAPITAL1", "FENOMEN1"], markedItems: ["CAPITAL1", "FENOMEN1"], markedAnnotations: ["ANNA0001", "ANNF0001"] };

  it("al deseleccionar un ítem se van sus marcas y las de sus anotaciones, y solo las suyas", () => {
    const d = derive(index, state({ ...base, selectedItems: ["CAPITAL1"] }));
    expect(d.markedItems).toEqual(["CAPITAL1"]);
    expect(d.markedAnnotations).toEqual(["ANNA0001"]);
  });

  it("cambiar de modo, de etiquetas o de búsqueda de contenido no las borra", () => {
    const d = derive(index, state({ ...base, mode: "annotation", selectedTags: ["Tomo I"], contentSearch: "uno" }));
    expect(d.markedItems).toEqual(["CAPITAL1", "FENOMEN1"]);
    expect(d.markedAnnotations).toEqual(["ANNA0001", "ANNF0001"]); // la de Hegel sigue marcada aunque los filtros la oculten
  });

  it("las marcas que los filtros ocultan siguen guardadas y cuentan para la salida, en el orden de los resultados", () => {
    const d = derive(index, state({ ...base, mode: "annotation", selectedTags: ["Tomo I"], markedAnnotations: ["ANNA0002", "ANNF0001"] }));
    expect(d.annotations.map((a) => a.key)).toEqual(["ANNA0001"]); // con el filtro solo se ve esa; las dos marcadas quedan ocultas
    expect(d.markedAnnotations).toEqual(["ANNA0002", "ANNF0001"]); // en el orden en que se marcaron
    expect(d.markedAnnotationList.map((a) => a.key)).toEqual(["ANNF0001", "ANNA0002"]); // orden de los ítems (por fecha: Hegel antes que Marx)
    expect(d.annotationsPlusMarked.map((a) => a.key)).toEqual(["ANNF0001", "ANNA0001", "ANNA0002"]);
    // sin marcas ocultas no se recompone nada
    const plain = derive(index, state({ ...base, mode: "annotation" }));
    expect(plain.annotationsPlusMarked).toBe(plain.annotations);
  });

  it("si el ítem deja de estar disponible (colección o búsqueda) sigue seleccionado y conserva sus marcas", () => {
    const d = derive(index, state({ ...base, collections: ["COLM"], includeSubcollections: false }));
    expect(d.selectedItems.sort()).toEqual([...base.selectedItems].sort());
    expect(d.markedItems).toEqual(base.markedItems);
    expect(d.markedAnnotations).toEqual(base.markedAnnotations);
  });

  it("al retirarse el ítem de la biblioteca (sincronización) se deselecciona y pierde sus marcas", () => {
    const d = derive(index, state({ ...base, selectedItems: ["CAPITAL1", "RETIRADO"], markedItems: ["CAPITAL1", "RETIRADO"] }));
    expect(d.selectedItems).toContain("CAPITAL1");
    expect(d.selectedItems).not.toContain("RETIRADO");
    expect(d.markedItems).toEqual(["CAPITAL1"]);
  });

  it("una marca de una clave que no existe se descarta", () => {
    const d = derive(index, state({ selectedItems: ["CAPITAL1"], markedAnnotations: ["NOEXISTE"] }));
    expect(d.markedAnnotations).toEqual([]);
  });

  it("no se guardan entre sesiones", () => {
    const saved = persistableState(state({ ...base })) as Record<string, unknown>;
    expect("markedItems" in saved).toBe(false);
    expect("markedAnnotations" in saved).toBe(false);
    const restored = restoreState({ ...saved, markedItems: ["CAPITAL1"], markedAnnotations: ["ANNA0001"] } as Partial<ViewState>);
    expect(restored.markedItems).toEqual([]);
    expect(restored.markedAnnotations).toEqual([]);
  });
});

describe("salida «marcadas»", () => {
  const sel = ["CAPITAL1", "FENOMEN1"];
  const items = derive(index, state({ selectedItems: sel }));
  const anns = (annotationIds: string[], over: Partial<ViewState> = {}) => derive(index, state({ selectedItems: sel, mode: "annotation", markedAnnotations: annotationIds, ...over }));

  it("modo Ítems: solo los ítems marcados, en cada tipo de salida", async () => {
    const full = await buildOutput(items, req("full"), marked("item", ["FENOMEN1"]), deps());
    expect(full.items).toBe(1);
    expect(full.text).toContain("## Fenomenología");
    expect(full.text).not.toContain("El Capital");
    const meta = await buildOutput(items, req("meta"), marked("item", ["CAPITAL1"]), deps());
    expect(meta.text).toContain("## El Capital");
    expect(meta.text).not.toContain("Fenomenología");
    const onlyAnn = await buildOutput(anns([]), req("annotations"), marked("item", ["CAPITAL1"]), deps());
    expect(onlyAnn.annotations).toBe(2);
    expect(onlyAnn.text).not.toContain("tres");
    const bib = await buildOutput(items, req("bibliography"), marked("item", ["FENOMEN1"]), deps());
    expect(bib.text).toBe("Entrada de FENOMEN1");
  });

  it("modo Anotaciones: «Metadata + anotaciones» lleva el ítem padre con solo las anotaciones marcadas", async () => {
    const full = await buildOutput(anns(["ANNA0002"]), req("full"), marked("annotation", ["ANNA0002"]), deps());
    expect(full.items).toBe(1);
    expect(full.annotations).toBe(1);
    expect(full.text).toContain("## El Capital");
    expect(full.text).toContain("> dos");
    expect(full.text).not.toContain("> uno");
    expect(full.text).not.toContain("Fenomenología");
  });

  it("modo Anotaciones: «Solo anotaciones» saca las marcadas con el orden y los grupos de la vista", async () => {
    const out = await buildOutput(anns(["ANNA0002", "ANNF0001"], { annotationGroup: "item" }), req("annotations"), marked("annotation", ["ANNA0002", "ANNF0001"]), deps());
    expect(out.annotations).toBe(2);
    expect(out.text.indexOf("### Fenomenología (1)")).toBeLessThan(out.text.indexOf("### El Capital (1)")); // el recuento es el de lo marcado
    expect(out.text).toContain("> dos");
    expect(out.text).toContain("> tres");
    expect(out.text).not.toContain("> uno");
  });

  it("modo Anotaciones: la bibliografía y la metadata incluyen solo los ítems con anotaciones marcadas", async () => {
    const bib = await buildOutput(anns(["ANNF0001"]), req("bibliography"), marked("annotation", ["ANNF0001"]), deps());
    expect(bib.text).toBe("Entrada de FENOMEN1");
    const meta = await buildOutput(anns(["ANNA0001", "ANNA0002"]), req("meta"), marked("annotation", ["ANNA0001", "ANNA0002"]), deps());
    expect(meta.items).toBe(1);
    expect(meta.text).toContain("## El Capital");
  });

  it("las anotaciones marcadas que los filtros ocultan también se sacan", async () => {
    // Con el filtro «Tomo I» no se ve la de Hegel (ANNF0001), pero está marcada.
    const d = anns(["ANNF0001", "ANNA0002"], { selectedTags: ["Tomo I"], annotationGroup: "item" });
    expect(d.annotations.map((a) => a.key)).not.toContain("ANNF0001");
    const onlyAnn = await buildOutput(d, req("annotations"), marked("annotation", ["ANNF0001", "ANNA0002"]), deps());
    expect(onlyAnn.annotations).toBe(2);
    expect(onlyAnn.text).toContain("> tres");
    expect(onlyAnn.text).toContain("> dos");
    expect(onlyAnn.text).not.toContain("> uno");
    const full = await buildOutput(d, req("full"), marked("annotation", ["ANNF0001", "ANNA0002"]), deps());
    expect(full.items).toBe(2);
    expect(full.text).toContain("## Fenomenología");
    expect(full.text).toContain("> tres");
    const bib = await buildOutput(d, req("bibliography"), marked("annotation", ["ANNF0001"]), deps());
    expect(bib.text).toBe("Entrada de FENOMEN1");
  });

  it("sin marcas el alcance «todo» sigue sacando todo", async () => {
    const all = await buildOutput(items, req("full"), { type: "all" }, deps());
    expect(all.items).toBe(2);
    expect(all.annotations).toBe(3);
  });
});

describe("motor de plantillas: compilación única", () => {
  const eng = () => new TemplateEngine({ moment: moment as unknown as MomentFn, templates: new Map([["parte.md", "[{{ x }}]"]]) });

  it("la misma plantilla da el mismo resultado con contextos distintos", () => {
    const e = eng();
    expect(e.render("Hola {{ x }}", { x: 1 })).toBe("Hola 1");
    expect(e.render("Hola {{ x }}", { x: 2 })).toBe("Hola 2");
  });

  it("las plantillas incluidas se leen del conjunto vigente: si cambian, el resultado cambia", () => {
    const e = eng();
    expect(e.render("{% include 'parte.md' %}", { x: 1 })).toBe("[1]");
    e.setTemplates(new Map([["parte.md", "<{{ x }}>"]]));
    expect(e.render("{% include 'parte.md' %}", { x: 1 })).toBe("<1>");
  });

  it("los errores de plantilla siguen siendo TemplateError y no se quedan guardados", () => {
    const e = eng();
    expect(() => e.render("{% if %}", {})).toThrow(/Template|\[Line/);
    expect(() => e.render("{% if %}", {})).toThrow(); // segunda vez igual
    expect(e.render("ok {{ x }}", { x: 3 })).toBe("ok 3");
  });
});

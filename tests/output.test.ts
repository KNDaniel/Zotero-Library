import moment from "moment";
import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { bibHtmlToEntries, decodeEntities, htmlToMarkdown } from "../src/output/bibliography";
import { buildOutput, resolveTemplate, type BuildDeps, type OutputKind, type OutputRequest, type OutputScope, type OutputSettings } from "../src/output/build";
import { copyImages, describeImages, type ImageIO } from "../src/output/images";
import type { HttpClient, HttpResponse } from "../src/source/http";
import { LocalApiSource } from "../src/source/LocalApiSource";
import { DEFAULT_IMAGE_NAME_TEMPLATE, type ContextOptions } from "../src/template/context";
import { TemplateEngine, type MomentFn } from "../src/template/engine";
import { defaultViewState, derive, type ViewState } from "../src/ui/state";
import { annotation, attachment, collection, item } from "./fixtures";
import { ITEM_KEY, golden, goldenEntities, note, template } from "./goldenData";

const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
const opts = (dataDir = "C:/Z"): ContextOptions => ({ dataDir, imagesFolder: "Recursos/Img. Titulos", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) });
const settings = (over: Partial<OutputSettings> = {}): OutputSettings => ({ defaultTemplates: { full: "", meta: "", annotations: "", bibliography: "", link: "" }, defaultStyle: "apa", stripFrontmatterMulti: true, groupHeaders: true, ...over });
const req = (kind: OutputKind, over: Partial<OutputRequest> = {}): OutputRequest => ({ kind, template: "", style: "", ...over });
const ALL: OutputScope = { type: "all" };

function deps(index: LibraryIndex, over: Partial<BuildDeps> = {}, templates = new Map<string, string>()): BuildDeps {
  return {
    index, engine, templates, opts: opts(), settings: settings(),
    fetchBibliography: async (keys) => ({ entries: keys.map((k) => `Entrada de ${k}`), failed: [] }),
    ...over,
  };
}
const state = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultViewState(), ...over });

describe("salida: tu plantilla de importación", () => {
  const index = LibraryIndex.fromRaw({ entities: goldenEntities(), collections: [], libraryVersion: 1, total: 0, truncated: false });
  const templates = new Map([["import.md", template]]);
  const d = derive(index, state({ selectedItems: [ITEM_KEY] }));

  it("«Metadata + anotaciones» de un ítem es tu nota, byte a byte", async () => {
    const out = await buildOutput(d, req("full", { template: "import.md" }), ALL, deps(index, { opts: opts(golden.dataDir) }, templates));
    expect(out.text === note).toBe(true);
    expect(out.items).toBe(1);
    expect(out.annotations).toBe(71);
    expect(out.template).toBe("import.md");
    expect(out.warnings).toEqual([]);
  });

  it("las imágenes que referencia se devuelven con su ruta en el vault y en la caché de Zotero", async () => {
    const out = await buildOutput(d, req("full", { template: "import.md" }), ALL, deps(index, { opts: opts(golden.dataDir) }, templates));
    expect(out.images.map((i) => i.relativePath)).toEqual(["Recursos/Img. Titulos/ATTACH01-8-x98-y662.png", "Recursos/Img. Titulos/ATTACH01-49-x139-y630.png"]);
    expect(out.images[0].absolutePath).toBe("C:/ZoteroSynthetic/cache/library/ANN00001.png");
  });

  it("con etiquetas elegidas: la metadata completa y solo las anotaciones que coinciden", async () => {
    const tag = golden.annotations.find((a: { tags: string[] }) => a.tags.length)!.tags[0];
    const filtered = derive(index, state({ selectedItems: [ITEM_KEY], selectedTags: [tag], tagMatch: "any" }));
    const out = await buildOutput(filtered, req("full", { template: "import.md" }), ALL, deps(index, { opts: opts(golden.dataDir) }, templates));
    const blocks = out.text.split("\n").filter((l) => /^\^[A-Z0-9]{8}$/.test(l)).length;
    const expected = golden.annotations.filter((a: { tags: string[] }) => a.tags.includes(tag)).length;
    expect(blocks).toBe(expected);
    expect(blocks).toBeLessThan(71);
    expect(out.annotations).toBe(expected);
    expect(out.text).toContain("**Zotero**: [Synthetic PDF](zotero://select/library/items/ATTACH01)");
  });
});

describe("salida: varios ítems, anotaciones y alcance", () => {
  const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });
  const index = LibraryIndex.fromRaw({
    entities: [
      item("CAPITAL1", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867", collections: ["COLM"] }, { parsedDate: "1867" }),
      item("FENOMEN1", { title: "Fenomenología", creators: [au("Georg", "Hegel")], date: "1807", collections: ["COLH"] }, { parsedDate: "1807" }),
      attachment("ATTCAP01", "CAPITAL1"),
      attachment("ATTFEN01", "FENOMEN1"),
      annotation("ANNA0001", "ATTCAP01", { annotationSortIndex: "00001|0|0", tags: [{ tag: "Tomo I", type: 0 }], annotationText: "uno" }),
      annotation("ANNA0002", "ATTCAP01", { annotationSortIndex: "00002|0|0", tags: [], annotationText: "dos" }),
      annotation("ANNF0001", "ATTFEN01", { annotationType: "image", annotationText: "", annotationPosition: JSON.stringify({ pageIndex: 3, rects: [[10.2, 20.6, 50, 60]] }) }),
    ],
    collections: [collection("COLM", "Marx"), collection("COLH", "Hegel")],
    libraryVersion: 1, total: 0, truncated: false,
  });
  const fm = new Map([["fm.md", "---\ntitulo: {{ title }}\n---\nCuerpo de {{ title }}\n"]]);
  const both = derive(index, state({ selectedItems: ["CAPITAL1", "FENOMEN1"] }));
  const one = derive(index, state({ selectedItems: ["CAPITAL1"] }));

  it("con varios ítems quita el frontmatter de cada nota; con uno, lo respeta", async () => {
    const many = await buildOutput(both, req("full", { template: "fm.md" }), ALL, deps(index, {}, fm));
    expect(many.text).toBe("Cuerpo de Fenomenología\n\nCuerpo de El Capital\n"); // orden: autor (Hegel, Marx)
    const single = await buildOutput(one, req("full", { template: "fm.md" }), ALL, deps(index, {}, fm));
    expect(single.text).toBe("---\ntitulo: El Capital\n---\nCuerpo de El Capital\n");
    const keep = await buildOutput(both, req("full", { template: "fm.md" }), ALL, deps(index, { settings: settings({ stripFrontmatterMulti: false }) }, fm));
    expect(keep.text.match(/^---$/gm)).toHaveLength(4);
  });

  it("las plantillas incluidas producen Markdown con el título, las anotaciones y los enlaces", async () => {
    const full = await buildOutput(one, req("full"), ALL, deps(index));
    expect(full.text).toContain("## El Capital");
    expect(full.text).toContain("> uno");
    expect(full.text).toContain("> dos");
    expect(full.text).toContain("[p. VIII](zotero://open/library/items/ATTCAP01?page=VIII&annotation=ANNA0001)");
    expect(full.text).toContain("Tomo I");
    expect(full.annotations).toBe(2);
    const meta = await buildOutput(one, req("meta"), ALL, deps(index));
    expect(meta.text).toContain("## El Capital");
    expect(meta.text).not.toContain("> uno");
  });

  it("«Solo anotaciones» sigue el orden y la agrupación de la vista, con encabezados de grupo", async () => {
    const grouped = derive(index, state({ selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation", annotationGroup: "item" }));
    const out = await buildOutput(grouped, req("annotations"), ALL, deps(index));
    expect(out.text.indexOf("### Fenomenología (1)")).toBeLessThan(out.text.indexOf("### El Capital (2)"));
    expect(out.text).toContain("![[Recursos/Img. Titulos/ATTFEN01-4-x10-y21.png|300]]");
    expect(out.images.map((i) => i.relativePath)).toEqual(["Recursos/Img. Titulos/ATTFEN01-4-x10-y21.png"]);
    const plain = await buildOutput(grouped, req("annotations"), ALL, deps(index, { settings: settings({ groupHeaders: false }) }));
    expect(plain.text).not.toContain("###");
  });

  it("alcance de una sola anotación o de un solo ítem (botones de cada tarjeta)", async () => {
    const d = derive(index, state({ selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation" }));
    const a = await buildOutput(d, req("full"), { type: "annotation", key: "ANNA0002" }, deps(index));
    expect(a.annotations).toBe(1);
    expect(a.text).toContain("> dos");
    expect(a.text).not.toContain("> uno");
    const it1 = await buildOutput(d, req("meta"), { type: "item", key: "FENOMEN1" }, deps(index));
    expect(it1.items).toBe(1);
    expect(it1.text).toContain("## Fenomenología");
    expect(it1.text).not.toContain("El Capital");
    const itAnn = await buildOutput(d, req("annotations"), { type: "item", key: "CAPITAL1" }, deps(index));
    expect(itAnn.annotations).toBe(2);
  });

  it("agrupar por colección no repite un ítem en la salida de metadata", async () => {
    const withTwo = LibraryIndex.fromRaw({ entities: [item("DOBLE001", { collections: ["COLM", "COLH"], title: "En dos colecciones" })], collections: [collection("COLM", "Marx"), collection("COLH", "Hegel")], libraryVersion: 1, total: 1, truncated: false });
    const d = derive(withTwo, state({ selectedItems: ["DOBLE001"], itemGroup: "collection" }));
    expect(d.itemGroups.flatMap((g) => g.entries)).toHaveLength(2);
    const out = await buildOutput(d, req("meta"), ALL, deps(withTwo));
    expect(out.items).toBe(1);
  });

  it("bibliografía: una entrada por párrafo, o con una plantilla propia; estilo de la petición o del ajuste", async () => {
    const seen: string[] = [];
    const fetchBibliography: BuildDeps["fetchBibliography"] = async (keys, style) => {
      seen.push(`${style}:${keys.join(",")}`);
      return { entries: keys.map((k) => `Ref ${k}`), failed: [] };
    };
    const plain = await buildOutput(both, req("bibliography"), ALL, deps(index, { fetchBibliography }));
    expect(plain.text).toBe("Ref FENOMEN1\n\nRef CAPITAL1");
    const custom = await buildOutput(both, req("bibliography", { template: "bib.md", style: "iso690-author-date-es" }), ALL, deps(index, { fetchBibliography }, new Map([["bib.md", "{% for b in bibliography %}- {{ b }}\n{% endfor %}({{ count }}, {{ style }})"]])));
    expect(custom.text).toBe("- Ref FENOMEN1\n- Ref CAPITAL1\n(2, iso690-author-date-es)");
    expect(seen).toEqual(["apa:FENOMEN1,CAPITAL1", "iso690-author-date-es:FENOMEN1,CAPITAL1"]);
    const partial = await buildOutput(both, req("bibliography"), ALL, deps(index, { fetchBibliography: async () => ({ entries: ["Una"], failed: ["CAPITAL1"] }) }));
    expect(partial.warnings[0]).toContain("1 ítem(s) sin entrada");
  });

  it("plantilla elegida > por defecto de los ajustes > incluida, y avisa si falta", async () => {
    const t = new Map([["a.md", "A"], ["b.md", "B"]]);
    const defaults = { full: "b.md", meta: "", annotations: "", bibliography: "", link: "" };
    expect(resolveTemplate("full", "a.md", defaults, t)).toMatchObject({ name: "a.md", source: "A", builtin: false });
    expect(resolveTemplate("full", "", defaults, t)).toMatchObject({ name: "b.md", source: "B" });
    expect(resolveTemplate("meta", "", defaults, t).builtin).toBe(true);
    const missing = resolveTemplate("full", "nada.md", defaults, t);
    expect(missing).toMatchObject({ builtin: true, missing: "nada.md" });
    const out = await buildOutput(one, req("full", { template: "nada.md" }), ALL, deps(index));
    expect(out.warnings[0]).toContain("nada.md");
    expect(out.text).toContain("## El Capital");
  });

  it("un error de plantilla se propaga con su nombre", async () => {
    await expect(buildOutput(one, req("full", { template: "mala.md" }), ALL, deps(index, {}, new Map([["mala.md", "{% if %}"]])))).rejects.toThrow();
  });
});

describe("bibliografía de Zotero a Markdown", () => {
  it("decodifica entidades y conserva cursiva, negrita, enlaces y <sup>", () => {
    expect(decodeEntities("A &amp; B &#233; &#x2014; &quot;x&quot;")).toBe('A & B é — "x"');
    expect(htmlToMarkdown('Marx, K. (2010). <i>El Capital</i>. Lib. 1<sup>o</sup>. <a href="https://doi.org/x">doi</a> &amp; <b>más</b>')).toBe(
      "Marx, K. (2010). *El Capital*. Lib. 1<sup>o</sup>. [doi](https://doi.org/x) & **más**",
    );
  });
  it("extrae cada entrada, también las de estilos numéricos con <div> anidados", () => {
    const apa = '<div class="csl-bib-body"><div data-csl-entry-id="a" class="csl-entry">Hegel, G. (1807). <i>Fenomenología</i>.</div><div data-csl-entry-id="b" class="csl-entry">Marx, K. (1867). <i>El Capital</i>.</div></div>';
    expect(bibHtmlToEntries(apa)).toEqual(["Hegel, G. (1807). *Fenomenología*.", "Marx, K. (1867). *El Capital*."]);
    const numeric = '<div class="csl-bib-body"><div class="csl-entry"><div class="csl-left-margin">[1]</div><div class="csl-right-inline">Marx, K. <i>El Capital</i>.</div></div></div>';
    expect(bibHtmlToEntries(numeric)).toEqual(["[1] Marx, K. *El Capital*."]);
    expect(bibHtmlToEntries("Texto sin estructura")).toEqual(["Texto sin estructura"]);
    expect(bibHtmlToEntries("")).toEqual([]);
  });

  const res = (text: string, status = 200): HttpResponse => ({ status, headers: {}, text, json: null });
  const entry = (t: string) => `<div class="csl-entry">${t}</div>`;
  function source(handler: (u: URL) => HttpResponse) {
    const calls: string[] = [];
    const http: HttpClient = async ({ url }) => {
      calls.push(url);
      return handler(new URL(url));
    };
    return { src: new LocalApiSource({ baseUrl: "http://127.0.0.1:23119", libraryPath: "users/0", http }), calls };
  }

  it("pide por lotes y respeta el orden que decide el estilo", async () => {
    const { src, calls } = source(() => res(`<div class="csl-bib-body">${entry("Hegel")}${entry("Marx")}</div>`));
    const r = await src.fetchBibliography(["MARX0001", "HEGEL001"], "apa");
    expect(r).toEqual({ entries: ["Hegel", "Marx"], failed: [], mode: "batch" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("itemKey=MARX0001%2CHEGEL001");
    expect(calls[0]).toContain("format=bib");
  });
  it("si el lote no devuelve las entradas esperadas, pide ítem a ítem", async () => {
    const { src, calls } = source((u) => (u.pathname.endsWith("/items") ? res("<div></div>") : res(`<div class="csl-bib-body">${entry(`Ref ${u.pathname.split("/").pop()}`)}</div>`)));
    const r = await src.fetchBibliography(["AAAAAAA1", "BBBBBBB2"], "apa");
    expect(r.mode).toBe("single");
    expect(r.entries).toEqual(["Ref AAAAAAA1", "Ref BBBBBBB2"]);
    expect(calls).toHaveLength(3);
  });
  it("los ítems que fallan se anotan sin romper el resto", async () => {
    const { src } = source((u) => (u.pathname.endsWith("/items") ? res("", 500) : u.pathname.endsWith("BBBBBBB2") ? res("", 404) : res(`<div class="csl-bib-body">${entry("OK")}</div>`)));
    const r = await src.fetchBibliography(["AAAAAAA1", "BBBBBBB2"], "apa");
    expect(r.entries).toEqual(["OK"]);
    expect(r.failed).toEqual(["BBBBBBB2"]);
  });
  it("un estilo que Zotero no tiene da un error claro", async () => {
    const { src } = source(() => res("", 400));
    await expect(src.fetchBibliography(["AAAAAAA1"], "iso690-numeric-es")).rejects.toThrow("«iso690-numeric-es» no está disponible");
  });
  it("divide en lotes de 50", async () => {
    const keys = Array.from({ length: 120 }, (_, i) => `K${String(i).padStart(7, "0")}`);
    const { src, calls } = source((u) => res(`<div class="csl-bib-body">${u.searchParams.get("itemKey")!.split(",").map((k) => entry(k)).join("")}</div>`));
    const r = await src.fetchBibliography(keys, "apa");
    expect(calls).toHaveLength(3);
    expect(r.entries).toEqual(keys);
  });
});

describe("copia de imágenes al vault", () => {
  function io(initialVault: string[], disk: string[], failOn?: string) {
    const vault = new Set(initialVault);
    const folders = new Set<string>();
    const written: string[] = [];
    const impl: ImageIO = {
      vaultExists: async (p) => vault.has(p),
      diskExists: async (p) => disk.includes(p),
      realpath: async (p) => p,
      readDisk: async (p) => new TextEncoder().encode(p).buffer as ArrayBuffer,
      ensureFolder: async (p) => void folders.add(p),
      writeVault: async (p) => {
        if (p === failOn) throw new Error("disco lleno");
        vault.add(p);
        written.push(p);
      },
    };
    return { impl, vault, folders, written };
  }
  const img = (n: string) => ({ relativePath: `Recursos/Img. Titulos/${n}.png`, absolutePath: `C:/Z/cache/library/${n}.png` });

  it("copia lo que falta, reutiliza lo que ya está y avisa de lo que no encuentra", async () => {
    const t = io([img("VIEJO001").relativePath], [img("NUEVO001").absolutePath, img("VIEJO001").absolutePath]);
    const r = await copyImages([img("NUEVO001"), img("VIEJO001"), img("PERDIDO1")], t.impl, "Recursos/Img. Titulos", "C:/Z");
    expect(r.copied).toEqual([img("NUEVO001").relativePath]);
    expect(r.existing).toEqual([img("VIEJO001").relativePath]);
    expect(r.missing).toEqual([img("PERDIDO1").relativePath]);
    expect(t.folders).toEqual(new Set(["Recursos/Img. Titulos"]));
    expect(describeImages(r)).toEqual(["1 imagen(es) copiada(s) al vault", "1 imagen(es) no encontrada(s) en la caché de Zotero"]);
  });
  it("no repite la misma imagen y un fallo no impide copiar las demás", async () => {
    const t = io([], [img("IMGAAAA1").absolutePath, img("IMGAAAA2").absolutePath], img("IMGAAAA1").relativePath);
    const r = await copyImages([img("IMGAAAA1"), img("IMGAAAA1"), img("IMGAAAA2")], t.impl, "Recursos/Img. Titulos", "C:/Z");
    expect(r.failed).toEqual([{ path: img("IMGAAAA1").relativePath, error: "disco lleno" }]);
    expect(r.copied).toEqual([img("IMGAAAA2").relativePath]);
    expect(describeImages(r)).toContain("1 imagen(es) con error al copiar");
  });
  it("rechaza una ruta de imagen que intenta salir de la carpeta permitida antes de consultar o escribir", async () => {
    const t = io([], ["C:/Z/cache/library/ataque.png"]);
    const malicious = { relativePath: "Recursos/../../.obsidian/plugins/ataque.png", absolutePath: "C:/Z/cache/library/ataque.png" };
    const r = await copyImages([malicious], t.impl, "Recursos/Img. Titulos", "C:/Z");
    expect(r.failed).toEqual([{ path: malicious.relativePath, error: "La ruta de destino no es un PNG directo dentro de la carpeta de imágenes." }]);
    expect(t.written).toEqual([]);
    expect(t.folders.size).toBe(0);
  });
  it("rechaza orígenes fuera de cache/library antes de consultar o leerlos", async () => {
    const t = io([], ["C:/Z/private/IMGAAAA1.png", "C:/Z/cache/library/../../private/IMGAAAA2.png"]);
    t.impl.diskExists = async () => { throw new Error("No debe consultar fuera de la caché"); };
    const outside = { ...img("IMGAAAA1"), absolutePath: "C:/Z/private/IMGAAAA1.png" };
    const traversal = { ...img("IMGAAAA2"), absolutePath: "C:/Z/cache/library/../../private/IMGAAAA2.png" };
    const r = await copyImages([outside, traversal], t.impl, "Recursos/Img. Titulos", "C:/Z");
    expect(r.failed).toEqual([
      { path: outside.relativePath, error: "La ruta de origen de imagen no pertenece a cache/library de Zotero." },
      { path: traversal.relativePath, error: "La ruta de origen de imagen no pertenece a cache/library de Zotero." },
    ]);
    expect(r.copied).toEqual([]);
    expect(t.written).toEqual([]);
  });
  it("rechaza un PNG de caché cuyo destino real es un enlace fuera de ella", async () => {
    const t = io([], [img("IMGAAAA1").absolutePath]);
    t.impl.realpath = async () => "C:/Z/private/IMGAAAA1.png";
    const r = await copyImages([img("IMGAAAA1")], t.impl, "Recursos/Img. Titulos", "C:/Z");
    expect(r.failed).toEqual([{ path: img("IMGAAAA1").relativePath, error: "La ruta de origen de imagen no pertenece a cache/library de Zotero." }]);
    expect(t.written).toEqual([]);
  });
});

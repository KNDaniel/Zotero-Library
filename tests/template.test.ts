import moment from "moment";
import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { annotationKeysIn, compareText, formatComparison } from "../src/template/compare";
import { DEFAULT_IMAGE_NAME_TEMPLATE, annotationContext, attachmentFilePath, itemContext, standaloneAnnotationContext, type ContextOptions } from "../src/template/context";
import { TemplateEngine, TemplateError, type MomentFn } from "../src/template/engine";
import { fileUri, openAnnotationUri, zoteroOpenUri } from "../src/template/links";
import { buildTemplateMap, listTemplates, listTemplatesInTree, relativeToFolder } from "../src/template/manager";
import { annotation, attachment, item } from "./fixtures";

const engine = (templates?: Map<string, string>) => new TemplateEngine({ moment: moment as unknown as MomentFn, templates });
const opts = (e: TemplateEngine, over: Partial<ContextOptions> = {}): ContextOptions => ({
  dataDir: "C:\\ZoteroSynthetic",
  imagesFolder: "Recursos/Img. Titulos/",
  imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE,
  renderString: (t, c) => e.render(t, c),
  ...over,
});

const au = (first: string, last: string, creatorType = "author") => ({ creatorType, firstName: first, lastName: last });
const index = LibraryIndex.fromRaw({
  entities: [
    item("ITEMAAAA", { title: "El Capital", creators: [au("Karl", "Marx"), au("Friedrich", "Engels"), au("Pedro", "Scaron", "translator"), au("Ed", "Itor", "editor")], date: "2010-Jun", tags: [{ tag: "economía", type: 0 }, { tag: "historia", type: 0 }], relations: { "dc:relation": "http://zotero.org/users/1/items/ITEMBBBB" } }, { parsedDate: "2010-06" }),
    item("ITEMBBBB", { title: "Fragmento", creators: [au("Karl", "Marx")] }),
    attachment("ATTPDF01", "ITEMAAAA", { filename: "Marx - 2010 - El Capital (Scaron).pdf", title: "PDF" }),
    attachment("ATTLINK1", "ITEMAAAA", { linkMode: "linked_file", path: "D:\\Libros\\capital.pdf", contentType: "application/pdf", title: "Enlace", dateAdded: "2025-01-01T00:00:00Z" }),
    attachment("ATTHTML1", "ITEMBBBB", { contentType: "text/html", filename: "snap.html", title: "Snapshot" }),
    annotation("ANNIMG01", "ATTPDF01", { annotationType: "image", annotationPosition: JSON.stringify({ pageIndex: 48, rects: [[138.929, 629.643, 437.5, 701.3]] }), annotationPageLabel: "5" }),
    annotation("ANNTXT01", "ATTPDF01", { annotationText: "Una <i>cursiva</i> & más", annotationSortIndex: "00002|000001|00001", tags: [{ tag: "Tomo I", type: 0 }] }),
    annotation("ANNHTML1", "ATTHTML1", { annotationPosition: JSON.stringify({ type: "CssSelector", value: "#article-body > p:nth-child(5)" }), annotationPageLabel: "" }),
  ],
  collections: [],
  libraryVersion: 1,
  total: 0,
  truncated: false,
});
const e = engine();
const ctxOf = (key = "ITEMAAAA", o: Partial<ContextOptions> = {}) => {
  const it = index.items.get(key)!;
  const all = index.annotationsOf(key);
  return itemContext(index, it, all, all, opts(e, o));
};

describe("enlaces", () => {
  it("fileUri solo codifica los espacios y normaliza las barras", () => {
    expect(fileUri("C:\\ZoteroSynthetic\\storage\\K\\a b – 1º.pdf")).toBe("file://C:/ZoteroSynthetic/storage/K/a%20b%20–%201º.pdf");
  });
  it("los enlaces de anotación son siempre `open`, con página si la hay y solo con la clave si no", () => {
    expect(zoteroOpenUri("ATT")).toBe("zotero://open/library/items/ATT");
    expect(openAnnotationUri("ATT", "VIII", "ANN")).toBe("zotero://open/library/items/ATT?page=VIII&annotation=ANN");
    expect(openAnnotationUri("ATT", undefined, "ANN")).toBe("zotero://open/library/items/ATT?annotation=ANN");
    expect(openAnnotationUri("ATT", "", "ANN")).toBe("zotero://open/library/items/ATT?annotation=ANN");
    expect(openAnnotationUri("ATT", "VIII", "ANN")).not.toContain("open-pdf");
  });
  it("ruta de archivo según el tipo de adjunto", () => {
    expect(attachmentFilePath(index.attachments.get("ATTPDF01")!, "C:\\ZoteroSynthetic\\")).toBe("C:\\ZoteroSynthetic/storage/ATTPDF01/Marx - 2010 - El Capital (Scaron).pdf");
    expect(attachmentFilePath(index.attachments.get("ATTLINK1")!, "x")).toBe("D:\\Libros\\capital.pdf");
  });
});

describe("contexto de ítem", () => {
  const c = ctxOf();
  it("campos planos, nombres compatibles y cadenas de personas", () => {
    expect(c.title).toBe("El Capital");
    expect(c.publisher).toBe("Siglo Veintiuno");
    expect(c.ISBN).toBe("978-84-323-1592-3");
    expect(c.authors).toBe("Karl Marx, Friedrich Engels");
    expect(c.translators).toBe("Pedro Scaron");
    expect(c.editors).toBe("Ed Itor");
    expect(c.directors).toBe("");
    expect(c.allTags).toBe("economía, historia");
  });
  it("la fecha es ISO y conserva el texto original", () => {
    expect(c.date).toBe("2010-06-01");
    expect(c.dateText).toBe("2010-Jun");
    expect(e.render('{{ date | format("YYYY-MM-DD") }}|{{ date | format("DD/MM/YYYY") }}', c)).toBe("2010-06-01|01/06/2010");
  });
  it("primer adjunto, enlaces y relacionados", () => {
    expect((c.attachments as Array<{ itemKey: string }>).map((a) => a.itemKey)).toEqual(["ATTPDF01", "ATTLINK1"]); // por fecha de alta
    expect(c.firstAttachmentZoteroLink).toBe("[PDF](zotero://select/library/items/ATTPDF01)");
    expect(c.firstAttachmentLink).toBe("[PDF](file://C:/ZoteroSynthetic/storage/ATTPDF01/Marx%20-%202010%20-%20El%20Capital%20(Scaron).pdf)");
    const rel = (c.relations as Array<Record<string, unknown>>)[0];
    expect(rel.title).toBe("Fragmento");
    expect(rel.desktopURI).toBe("zotero://select/library/items/ITEMBBBB");
  });
  it("sin lastImportDate la propiedad no existe; con ella, sí", () => {
    expect("lastImportDate" in c).toBe(false);
    expect(ctxOf("ITEMAAAA", { lastImportDate: "2024-01-01" }).lastImportDate).toBe("2024-01-01");
  });
  it("ítem sin adjunto ni fecha no rompe nada", () => {
    const i2 = LibraryIndex.fromRaw({ entities: [item("ITEMCCCC", { date: "" }, { parsedDate: undefined })], collections: [], libraryVersion: 1, total: 1, truncated: false });
    const ctx = itemContext(i2, i2.items.get("ITEMCCCC")!, [], [], opts(e));
    expect(ctx.firstAttachmentLink).toBe("");
    expect(ctx.date).toBe("");
    expect(e.render('[{{ date | format("YYYY") }}]', ctx)).toBe("[]");
  });
  it("conserva todos los campos y el objeto crudo", () => {
    expect((c.raw as { data: { publisher: string } }).data.publisher).toBe("Siglo Veintiuno");
    expect((c.item as { fields: Record<string, string> }).fields.ISBN).toBe("978-84-323-1592-3");
  });
});

describe("contexto de anotación", () => {
  it("imagen: ruta y nombre configurables", () => {
    const a = index.annotations.get("ANNIMG01")!;
    expect(annotationContext(index, a, opts(e)).imageRelativePath).toBe("Recursos/Img. Titulos/ATTPDF01-49-x139-y630.png");
    const custom = annotationContext(index, a, opts(e, { imagesFolder: "Img", imageNameTemplate: "{{ annotationKey }}_p{{ pageLabel }}" }));
    expect(custom.imageRelativePath).toBe("Img/ANNIMG01_p5.png");
    expect(custom.imagePath).toBe("C:\\ZoteroSynthetic/cache/library/ANNIMG01.png");
  });
  it("no construye rutas de imagen para claves de Zotero malformadas", () => {
    const a = index.annotations.get("ANNIMG01")!;
    const ctx = annotationContext(index, { ...a, key: "../../outside" }, opts(e));
    expect(ctx.imagePath).toBe("");
    expect(ctx.imageRelativePath).toBe("");
  });
  it("limita el nombre de imagen generado por la plantilla a un archivo dentro de la carpeta configurada", () => {
    const a = index.annotations.get("ANNIMG01")!;
    const custom = annotationContext(index, a, opts(e, { imagesFolder: "Recursos/Img", imageNameTemplate: "../../.obsidian/plugins" }));
    expect(custom.imageRelativePath).toBe("Recursos/Img/-..-.obsidian-plugins.png");
  });
  it("el enlace de la anotación es `open`: con página en un PDF y solo `?annotation=` en una captura web", () => {
    expect(annotationContext(index, index.annotations.get("ANNTXT01")!, opts(e)).desktopURI).toBe("zotero://open/library/items/ATTPDF01?page=VIII&annotation=ANNTXT01");
    expect(annotationContext(index, index.annotations.get("ANNHTML1")!, opts(e)).desktopURI).toMatch(/^zotero:\/\/open\/library\/items\/[A-Z0-9]+\?annotation=ANNHTML1$/);
  });
  it("las anotaciones de captura web conservan su posición y no tienen página", () => {
    const a = index.annotations.get("ANNHTML1")!;
    expect(index.diagnostics.nonPdfPositions).toContain("ANNHTML1");
    expect(index.diagnostics.unparsablePositions).not.toContain("ANNHTML1");
    expect(annotationContext(index, a, opts(e)).page).toBeUndefined();
    expect((annotationContext(index, a, opts(e)).fields as Record<string, string>).annotationPosition).toContain("CssSelector");
  });
  it("contexto independiente: anotación + ítem padre plano", () => {
    const ctx = standaloneAnnotationContext(index, index.annotations.get("ANNTXT01")!, opts(e), 3);
    expect(ctx.title).toBe("El Capital");
    expect((ctx.annotation as { id: string }).id).toBe("ANNTXT01");
    expect(ctx.index).toBe(3);
  });
});

describe("motor de plantillas", () => {
  it("no escapa HTML ni símbolos", () => {
    const ctx = ctxOf();
    expect(e.render("{{ annotations[0].annotatedText }}", ctx)).toBe("Una <i>cursiva</i> & más");
  });
  it("filterby: fechas, texto y entradas no lista", () => {
    const list = [{ date: "2024-01-01" }, { date: "2025-06-01" }];
    const out = e.render('{{ (l | filterby("date", "dateafter", "2024-12-31")).length }}/{{ (l | filterby("date", "datebefore", "2024-12-31")).length }}', { l: list });
    expect(out).toBe("1/1");
    expect(e.render('{{ (l | filterby("name", "contains", "AR")).length }}', { l: [{ name: "Marx" }, { name: "Hegel" }] })).toBe("1");
    expect(e.render('{{ (x | filterby("a", "contains", "b")).length }}', { x: null })).toBe("0");
  });
  it("include e import desde la carpeta de plantillas", () => {
    const templates = new Map([
      ["parts/meta", "**{{ title }}** ({{ publisher }})"],
      ["macros.md", "{% macro tag(t) %}#{{ t }}{% endmacro %}"],
    ]);
    const eng = engine(templates);
    const src = '{% import "macros" as m %}{% include "parts/meta" %} {{ m.tag("x") }}';
    expect(eng.render(src, { title: "T", publisher: "P" })).toBe("**T** (P) #x");
  });
  it("las variables de un bucle llegan a la parte incluida", () => {
    const eng = engine(new Map([["ann", "- {{ annotation.id }}"]]));
    const out = eng.render('{% for annotation in annotations %}{% include "ann" %}\n{% endfor %}', { annotations: [{ id: "A" }, { id: "B" }] });
    expect(out).toBe("- A\n- B\n");
  });
  it("errores claros de plantilla", () => {
    expect(() => e.render("{% if %}", {}, "mala")).toThrow(TemplateError);
    expect(() => e.render('{% include "noexiste" %}', {}, "otra")).toThrow(/noexiste/);
  });

  it("copia el contexto y elimina propiedades de prototipo de datos externos", () => {
    const payload = Object.create(null) as Record<string, unknown>;
    payload.title = "Metadato";
    Object.defineProperty(payload, "constructor", { value: "no debe exponerse", enumerable: true });
    payload.nested = { prototype: "no debe exponerse", value: "seguro" };
    const out = e.render("{{ payload.title }}|{{ payload.constructor | default('bloqueado') }}|{{ payload.nested.prototype | default('bloqueado') }}|{{ values | join(',') }}", {
      payload,
      values: ["uno", "dos"],
    });
    expect(out).toBe("Metadato|bloqueado|bloqueado|uno,dos");
  });
});

describe("gestor de plantillas", () => {
  const files = [
    { path: "Zotero/Plantillas/render/item.md", content: "I" },
    { path: "Zotero/Plantillas/print/completa.md", content: "C" },
    { path: "Zotero/Plantillas/notas.png", content: "x" },
    { path: "Otra/cosa.md", content: "O" },
  ];
  it("relativiza y lista solo plantillas de la carpeta", () => {
    expect(relativeToFolder("Zotero/Plantillas/render/item.md", "Zotero/Plantillas/")).toBe("render/item.md");
    expect(relativeToFolder("Otra/cosa.md", "Zotero/Plantillas")).toBeNull();
    expect(listTemplates(files.map((f) => f.path), "Zotero/Plantillas")).toEqual(["print/completa.md", "render/item.md"]);
  });
  it("recorre solo la rama configurada y omite archivos no plantilla", () => {
    const tree = {
      path: "Zotero/Plantillas",
      children: [
        { path: "Zotero/Plantillas/item.md" },
        { path: "Zotero/Plantillas/sub", children: [{ path: "Zotero/Plantillas/sub/link.njk" }, { path: "Zotero/Plantillas/sub/image.png" }] },
      ],
    };
    expect(listTemplatesInTree(tree, "Zotero/Plantillas")).toEqual(["item.md", "sub/link.njk"]);
  });
  it("cada plantilla se puede citar por ruta, sin extensión o por nombre", () => {
    const map = buildTemplateMap(files, "Zotero/Plantillas");
    expect(map.get("render/item.md")).toBe("I");
    expect(map.get("render/item")).toBe("I");
    expect(map.get("item")).toBe("I");
    expect(map.get("completa")).toBe("C");
    expect(map.has("cosa")).toBe(false);
  });
  it("un nombre ambiguo no se registra", () => {
    const map = buildTemplateMap([{ path: "T/a/x.md", content: "1" }, { path: "T/b/x.md", content: "2" }], "T");
    expect(map.has("x")).toBe(false);
    expect(map.get("a/x")).toBe("1");
  });
});

describe("comparación de textos", () => {
  it("idéntico y diferencias con números de línea", () => {
    expect(compareText("a\nb\r\n", "a\nb\n").identical).toBe(true);
    const c = compareText("a\nX\nc", "a\nb\nc\nd");
    expect(c.total).toBe(2);
    expect(c.differences[0]).toEqual({ line: 2, actual: "X", expected: "b" });
    expect(formatComparison(c)).toContain("Línea 2");
    expect(formatComparison(compareText("x", "x"))).toContain("Idéntico");
  });
});

describe("claves de anotación en las diferencias", () => {
  it("extrae las claves de las líneas de cabecera, enlace y bloque", () => {
    const actual = [
      "> [!zotero-yellow] Relevante <br> N. 56 Highl... <br> PSMEH7YG",
      "🔎 - ([p. 9](zotero://open-pdf/library/items/ATTACH01?page=9&annotation=PSMEH7YG))  ",
      "^PSMEH7YG",
    ].join("\n");
    const expected = [
      "> [!zotero-blue] Hechos <br> N. 56 Highl... <br> UK83PLMA",
      "🔎 - ([p. 9](zotero://open-pdf/library/items/ATTACH01?page=9&annotation=UK83PLMA))  ",
      "^UK83PLMA",
    ].join("\n");
    const c = compareText(actual, expected);
    expect(annotationKeysIn(c).sort()).toEqual(["PSMEH7YG", "UK83PLMA"]);
  });
  it("sin diferencias no hay claves", () => {
    expect(annotationKeysIn(compareText("a", "a"))).toEqual([]);
  });
});

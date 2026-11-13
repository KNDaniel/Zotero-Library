import moment from "moment";
import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { buildOutput, resolveTemplate, OUTPUT_KINDS, type BuildDeps, type OutputRequest, type OutputScope, type OutputSettings } from "../src/output/build";
import { DEFAULT_IMAGE_NAME_TEMPLATE, type ContextOptions } from "../src/template/context";
import { TemplateEngine, type MomentFn } from "../src/template/engine";
import { LINK_TEMPLATES, linkTemplateById } from "../src/template/linkTemplates";
import { defaultViewState, derive, type ViewState } from "../src/ui/state";
import { annotation, attachment, item } from "./fixtures";

const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
const opts: ContextOptions = { dataDir: "/Z", imagesFolder: "Img", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) };
const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });

const index = LibraryIndex.fromRaw({
  entities: [
    item("CAPITAL1", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867" }, { parsedDate: "1867" }),
    item("CORCHETE", { title: "Obras [selección] de Hegel", creators: [au("Georg", "Hegel")], date: "1807" }, { parsedDate: "1807" }),
    item("SINADJ01", { title: "Sin adjuntos", creators: [au("Ana", "Zeta")], date: "2000" }, { parsedDate: "2000" }),
    attachment("ATTCAP01", "CAPITAL1"),
    attachment("ATTWEB01", "CORCHETE", { contentType: "text/html", linkMode: "imported_url", filename: "web.html" }),
    annotation("ANNPDF01", "ATTCAP01", { annotationSortIndex: "00001|000001|00001" }),
    annotation("ANNWEB01", "ATTWEB01", { annotationPageLabel: "", annotationPosition: JSON.stringify({ type: "CssSelector", value: "#a > p" }) }),
  ],
  collections: [],
  libraryVersion: 1,
  total: 0,
  truncated: false,
});
const settings = (link = ""): OutputSettings => ({ defaultTemplates: { full: "", meta: "", annotations: "", bibliography: "", link }, defaultStyle: "apa", stripFrontmatterMulti: true, groupHeaders: true });
const deps = (over: Partial<BuildDeps> = {}, templates = new Map<string, string>()): BuildDeps => ({
  index, engine, templates, opts, settings: settings(), fetchBibliography: async () => ({ entries: [], failed: [] }), ...over,
});
const state = (over: Partial<ViewState> = {}): ViewState => ({ ...defaultViewState(), ...over });
const link = (template = "", over: Partial<OutputRequest> = {}): OutputRequest => ({ kind: "link", template, style: "", ...over });
const ALL: OutputScope = { type: "all" };
const b = (id: string) => `builtin:${id}`;

describe("0.9.4: salida «Enlace Markdown»", () => {
  const d = derive(index, state({ selectedItems: ["CAPITAL1", "CORCHETE", "SINADJ01"] }));
  const one = (key: string) => derive(index, state({ selectedItems: [key] }));

  it("es una opción más de la lista de salidas, con cinco plantillas incluidas", () => {
    expect(OUTPUT_KINDS.map((k) => k.label)).toContain("Enlace Markdown");
    expect(LINK_TEMPLATES.map((t) => t.label)).toEqual(["Título → seleccionar", "Título → abrir", "Solo select", "Solo open", "ID"]);
    expect(linkTemplateById("builtin:id")?.label).toBe("ID");
    expect(linkTemplateById("id")).toBeUndefined();
    expect(linkTemplateById("builtin:nada")).toBeUndefined();
  });

  it("ítem: cada plantilla incluida produce su enlace", async () => {
    const out = async (id: string) => (await buildOutput(one("CAPITAL1"), link(b(id)), ALL, deps())).text;
    expect(await out("title-select")).toBe("[El Capital](zotero://select/library/items/CAPITAL1)");
    expect(await out("title-open")).toBe("[El Capital](zotero://open/library/items/ATTCAP01?page=1)"); // un PDF se abre en la primera página
    expect(await out("only-select")).toBe("[select](zotero://select/library/items/CAPITAL1)");
    expect(await out("only-open")).toBe("[open](zotero://open/library/items/ATTCAP01?page=1)");
    expect(await out("id")).toBe("CAPITAL1");
  });

  it("por defecto sale «Título → seleccionar»", async () => {
    const r = await buildOutput(one("CAPITAL1"), link(), ALL, deps());
    expect(r.text).toBe("[El Capital](zotero://select/library/items/CAPITAL1)");
    expect(r.template).toBe("Título → seleccionar");
    expect(r.warnings).toEqual([]);
  });

  it("los corchetes del título se escapan para no romper el enlace", async () => {
    const r = await buildOutput(one("CORCHETE"), link(b("title-select")), ALL, deps());
    expect(r.text).toBe("[Obras \\[selección\\] de Hegel](zotero://select/library/items/CORCHETE)");
  });

  it("sin adjunto, «abrir» cae en seleccionar el ítem", async () => {
    const r = await buildOutput(one("SINADJ01"), link(b("only-open")), ALL, deps());
    expect(r.text).toBe("[open](zotero://select/library/items/SINADJ01)");
  });

  it("varios ítems: un enlace por línea, en el orden mostrado", async () => {
    const r = await buildOutput(d, link(b("only-select")), ALL, deps());
    const lines = r.text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.startsWith("[select](zotero://select/library/items/"))).toBe(true);
    expect(r.items).toBe(3);
  });

  it("un ítem concreto (botón de su tarjeta) solo da su enlace", async () => {
    const r = await buildOutput(d, link(b("id")), { type: "item", key: "CORCHETE" }, deps());
    expect(r.text).toBe("CORCHETE");
  });

  it("anotación: «abrir» apunta a la anotación con página; sin página, solo con su clave", async () => {
    const pdf = await buildOutput(one("CAPITAL1"), link(b("title-open")), { type: "annotation", key: "ANNPDF01" }, deps());
    expect(pdf.text).toBe("[El Capital](zotero://open/library/items/ATTCAP01?page=VIII&annotation=ANNPDF01)");
    const web = await buildOutput(one("CORCHETE"), link(b("only-open")), { type: "annotation", key: "ANNWEB01" }, deps());
    expect(web.text).toBe("[open](zotero://open/library/items/ATTWEB01?annotation=ANNWEB01)");
  });

  it("anotación: «ID» es la clave de la anotación y «seleccionar» el ítem", async () => {
    const id = await buildOutput(one("CAPITAL1"), link(b("id")), { type: "annotation", key: "ANNPDF01" }, deps());
    expect(id.text).toBe("ANNPDF01");
    const sel = await buildOutput(one("CAPITAL1"), link(b("only-select")), { type: "annotation", key: "ANNPDF01" }, deps());
    expect(sel.text).toBe("[select](zotero://select/library/items/CAPITAL1)");
  });

  it("en modo anotaciones, todo el resultado da un enlace por anotación", async () => {
    const r = await buildOutput(d, link(b("id"), { mode: "annotation" }), ALL, deps());
    expect(r.text.split("\n").sort()).toEqual(["ANNPDF01", "ANNWEB01"]);
    expect(r.annotations).toBe(2);
    expect(r.text).not.toContain("###"); // sin encabezados de grupo
  });

  it("las marcadas en modo anotaciones dan enlaces de anotaciones", async () => {
    const dm = derive(index, state({ selectedItems: ["CAPITAL1", "CORCHETE"], mode: "annotation", markedAnnotations: ["ANNWEB01"] }));
    const r = await buildOutput(dm, link(b("id")), { type: "marked", mode: "annotation", items: [], annotations: ["ANNWEB01"] }, deps());
    expect(r.text).toBe("ANNWEB01");
  });

  it("una plantilla de la carpeta sirve para ítems y para anotaciones", async () => {
    const templates = new Map([["mi-enlace.md", "{% if annotation %}{{ annotation.desktopURI }}{% else %}{{ title }}!{% endif %}"]]);
    expect((await buildOutput(one("CAPITAL1"), link("mi-enlace.md"), ALL, deps({}, templates))).text).toBe("El Capital!");
    expect((await buildOutput(one("CAPITAL1"), link("mi-enlace.md"), { type: "annotation", key: "ANNPDF01" }, deps({}, templates))).text).toBe("zotero://open/library/items/ATTCAP01?page=VIII&annotation=ANNPDF01");
  });

  it("la plantilla por defecto de los ajustes se usa si no se elige otra", async () => {
    const r = await buildOutput(one("CAPITAL1"), link(), ALL, deps({ settings: settings(b("id")) }));
    expect(r.text).toBe("CAPITAL1");
  });

  it("una plantilla que ya no existe avisa y se usa la incluida", async () => {
    const r = await buildOutput(one("CAPITAL1"), link("borrada.md"), ALL, deps());
    expect(r.warnings[0]).toContain("borrada.md");
    expect(r.text).toContain("[El Capital](");
  });

  it("resolveTemplate distingue la versión de ítem y la de anotación", () => {
    const empty = new Map<string, string>();
    const defs = settings().defaultTemplates;
    expect(resolveTemplate("link", b("title-open"), defs, empty).source).toContain("openURI");
    expect(resolveTemplate("link", b("title-open"), defs, empty, true).source).toContain("annotation.desktopURI");
    expect(resolveTemplate("full", "", defs, empty).builtin).toBe(true);
  });
});

import { DEFAULT_NOTE_NAME_TEMPLATE, MAX_NOTE_NAME_LENGTH, noteBaseName, sanitizeNoteName, uniqueNotePath } from "../src/output/noteName";

describe("0.9.4: nombre configurable de las notas nuevas", () => {
  const stamp = "2026-11-10 0255";
  const itemCtx = { title: "El Capital: crítica de la economía política", year: "1867", key: "CAPITAL1", authors: "Karl Marx" };

  it("el valor por defecto reproduce el nombre de siempre", () => {
    expect(DEFAULT_NOTE_NAME_TEMPLATE).toBe("Zotero Library {{ stamp }}");
    expect(noteBaseName(engine, { template: DEFAULT_NOTE_NAME_TEMPLATE, context: null, stamp, count: 3 })).toBe("Zotero Library 2026-11-10 0255");
    expect(noteBaseName(engine, { template: "", context: itemCtx, stamp, count: 1 })).toBe("Zotero Library 2026-11-10 0255");
  });

  it("con un solo ítem la plantilla puede usar sus variables", () => {
    const name = noteBaseName(engine, { template: "{{ authors }} ({{ year }}) - {{ title }}", context: itemCtx, stamp, count: 1 });
    expect(name).toBe("Karl Marx (1867) - El Capital- crítica de la economía política");
  });

  it("los caracteres no válidos se sustituyen y el nombre se limita en longitud", () => {
    expect(sanitizeNoteName('a\\b/c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(sanitizeNoteName("Línea\ndos [ref] #tag ^bloque")).toBe("Línea dos -ref- -tag -bloque");
    const long = sanitizeNoteName("x".repeat(500));
    expect(long).toHaveLength(MAX_NOTE_NAME_LENGTH);
    expect(sanitizeNoteName("termina con punto. ")).toBe("termina con punto");
  });

  it("con varios ítems solo hay stamp y count; si el nombre queda vacío vuelve al de por defecto", () => {
    expect(noteBaseName(engine, { template: "{{ count }} ítems - {{ stamp }}", context: null, stamp, count: 4 })).toBe("4 ítems - 2026-11-10 0255");
    expect(noteBaseName(engine, { template: "{{ title }}", context: null, stamp, count: 4 })).toBe("Zotero Library 2026-11-10 0255");
  });

  it("una plantilla con error no impide crear la nota", () => {
    expect(noteBaseName(engine, { template: "{% if %}", context: itemCtx, stamp, count: 1 })).toBe("Zotero Library 2026-11-10 0255");
  });

  it("si el nombre existe se añade la clave de Zotero y, si aun así existe, un número", async () => {
    const taken = new Set<string>(["Salidas/Marx.md"]);
    const exists = async (p: string) => taken.has(p);
    expect(await uniqueNotePath("Salidas/", "Hegel", "FENOMEN1", exists)).toBe("Salidas/Hegel.md");
    expect(await uniqueNotePath("Salidas/", "Marx", "CAPITAL1", exists)).toBe("Salidas/Marx CAPITAL1.md");
    taken.add("Salidas/Marx CAPITAL1.md");
    expect(await uniqueNotePath("Salidas/", "Marx", "CAPITAL1", exists)).toBe("Salidas/Marx CAPITAL1 (2).md");
    expect(await uniqueNotePath("Salidas/", "Marx", null, exists)).toBe("Salidas/Marx (2).md"); // con varios ítems no hay clave
  });

  it("la salida informa de qué trata la nota y de su único ítem o anotación", async () => {
    const d1 = derive(index, state({ selectedItems: ["CAPITAL1"] }));
    const item1 = await buildOutput(d1, { kind: "full", template: "", style: "" }, ALL, deps());
    expect(item1.entity).toBe("item");
    expect(item1.singleKey).toBe("CAPITAL1");
    expect(item1.single?.title).toBe("El Capital");
    const many = await buildOutput(derive(index, state({ selectedItems: ["CAPITAL1", "CORCHETE"] })), { kind: "full", template: "", style: "" }, ALL, deps());
    expect(many.single).toBeNull();
    expect(many.singleKey).toBeNull();
    const ann = await buildOutput(d1, { kind: "annotations", template: "", style: "" }, { type: "annotation", key: "ANNPDF01" }, deps());
    expect(ann.entity).toBe("annotation");
    expect(ann.singleKey).toBe("ANNPDF01");
    expect((ann.single?.annotation as { key: string }).key).toBe("ANNPDF01");
    const lnk = await buildOutput(d1, link(b("id")), ALL, deps());
    expect(lnk.entity).toBe("item");
    expect(lnk.singleKey).toBe("CAPITAL1");
  });
});

import { copyImages, describeImages, type ImageIO } from "../src/output/images";
import { LocalApiSource } from "../src/source/LocalApiSource";
import { runVerification, type FsLike } from "../src/verify/verify";
import type { HttpClient } from "../src/source/http";

describe("0.9.4: imágenes que faltan en la caché de Zotero", () => {
  const img = (key: string) => ({ relativePath: `Img/${key}.png`, absolutePath: `/Z/cache/library/${key}.png`, key });
  const io = (onDisk: string[]): ImageIO => ({
    vaultExists: async () => false,
    diskExists: async (p) => onDisk.includes(p),
    realpath: async (p) => p,
    readDisk: async () => new ArrayBuffer(1),
    ensureFolder: async () => undefined,
    writeVault: async () => undefined,
  });

  it("el resultado guarda las claves de las anotaciones cuya imagen falta", async () => {
      const r = await copyImages([img("AAAAAAA1"), img("BBBBBBB1"), img("CCCCCCC1")], io([img("BBBBBBB1").absolutePath]), "Img", "/Z");
    expect(r.copied).toEqual(["Img/BBBBBBB1.png"]);
    expect(r.missingKeys).toEqual(["AAAAAAA1", "CCCCCCC1"]);
  });

  it("el aviso nombra las claves y, si son muchas, resume el resto", async () => {
      const few = await copyImages([img("AAAAAAA1"), img("CCCCCCC1")], io([]), "Img", "/Z");
    expect(describeImages(few)).toEqual(["2 imagen(es) no encontrada(s) en la caché de Zotero (anotaciones: AAAAAAA1, CCCCCCC1)"]);
      const many = await copyImages(Array.from({ length: 8 }, (_, i) => img(`KEY0000${i}`)), io([]), "Img", "/Z");
    const text = describeImages(many)[0]!;
    expect(text).toContain("8 imagen(es) no encontrada(s)");
    expect(text).toContain("KEY00000, KEY00001, KEY00002, KEY00003, KEY00004 y 3 más");
    expect(text).not.toContain("KEY00005");
  });

  it("sin claves (imágenes sin identificar) el aviso sigue siendo el de siempre", () => {
    expect(describeImages({ copied: [], existing: [], missing: ["x.png"], missingKeys: [], failed: [] })).toEqual(["1 imagen(es) no encontrada(s) en la caché de Zotero"]);
  });

  it("la salida de anotaciones de imagen lleva la clave en cada imagen", async () => {
    const idx = LibraryIndex.fromRaw({
      entities: [item("ITEMIMG1", { title: "Con imagen" }), attachment("ATTIMG01", "ITEMIMG1"), annotation("IMGANN01", "ATTIMG01", { annotationType: "image", annotationPosition: JSON.stringify({ pageIndex: 0, rects: [[1, 2, 3, 4]] }) })],
      collections: [], libraryVersion: 1, total: 0, truncated: false,
    });
    const r = await buildOutput(derive(idx, state({ selectedItems: ["ITEMIMG1"] })), { kind: "annotations", template: "", style: "" }, ALL, deps({ index: idx }));
    expect(r.images.map((i) => i.key)).toEqual(["IMGANN01"]);
  });

  describe("informe de verificación", () => {
    const ok = { pageIndex: 0, rects: [[1, 2, 3, 4]] };
    const idx = LibraryIndex.fromRaw({
      entities: [
        item("ITEMAAAA", {}, { parsedDate: "2010-06" }),
        attachment("ATTACH01", "ITEMAAAA"),
        annotation("IMGCON01", "ATTACH01", { annotationType: "image", annotationPosition: JSON.stringify(ok) }),
        annotation("IMGSIN01", "ATTACH01", { annotationType: "image", annotationPosition: JSON.stringify(ok) }),
        annotation("IMGSIN02", "ATTACH01", { annotationType: "image", annotationPosition: JSON.stringify(ok) }),
        annotation("TEXTO001", "ATTACH01", {}),
      ],
      collections: [], libraryVersion: 1, total: 6, truncated: false,
    });
    const headers = { "content-type": "application/json" };
    const http: HttpClient = async () => ({ status: 200, headers, text: "[]", json: [] });
    const fs = (existing: string[]): FsLike => ({ exists: async (p) => existing.includes(p), readdir: async () => ["library"] });
    const source = new LocalApiSource({ baseUrl: "http://localhost:23119", libraryPath: "users/0", http });

    it("cuenta cuántas anotaciones de imagen tienen PNG y nombra las que no", async () => {
      const checks = await runVerification({ source, index: idx, fs: fs(["/z", "/z/storage", "/z/cache", "/z/cache/library/IMGCON01.png"]), dataDir: "/z" });
      const files = checks.find((c) => c.id === "files")!.details.join("\n");
      expect(files).toContain("Imágenes de anotaciones con PNG en la caché de Zotero: 1 de 3.");
      expect(files).toContain("IMGSIN01");
      expect(files).toContain("IMGSIN02");
      expect(files).not.toContain("TEXTO001");
    });

    it("también cuenta los PNG de la caché de grupos", async () => {
      const checks = await runVerification({ source, index: idx, fs: fs(["/z", "/z/storage", "/z/cache/groups/IMGSIN01.png"]), dataDir: "/z" });
      expect(checks.find((c) => c.id === "files")!.details.join("\n")).toContain("PNG en la caché de Zotero: 1 de 3.");
    });
  });
});

import { fileLinkToPath, localFileLink, zoteroOpenFirstPageUri } from "../src/template/links";

describe("0.9.5: primera página y enlace «Local»", () => {
  it("los PDF se abren en la primera página y el resto de adjuntos, no", () => {
    expect(zoteroOpenFirstPageUri("ATT", true)).toBe("zotero://open/library/items/ATT?page=1");
    expect(zoteroOpenFirstPageUri("ATT", false)).toBe("zotero://open/library/items/ATT");
  });

  it("localFileLink codifica lo que rompe un enlace Markdown", () => {
    expect(localFileLink("/home/testuser/Zotero/storage/ABCD1234/Marx (2010) - El Capital [Scaron] #1.pdf")).toBe(
      "file:///home/testuser/Zotero/storage/ABCD1234/Marx%20%282010%29%20-%20El%20Capital%20%5BScaron%5D%20%231.pdf",
    );
    expect(localFileLink("/d/ñandú 100%.pdf")).toBe("file:///d/%C3%B1and%C3%BA%20100%25.pdf");
  });

  it("las rutas de Windows quedan como file:///C:/…", () => {
    expect(localFileLink("C:\\Users\\Ana\\Zotero\\storage\\K\\a b.pdf")).toBe("file:///C:/Users/Ana/Zotero/storage/K/a%20b.pdf");
  });

  it("el enlace no contiene espacios ni paréntesis sin codificar, así que el Markdown no se rompe", () => {
    const url = localFileLink("/x/Obra (2ª ed.) final.pdf");
    expect(url).not.toMatch(/[ ()]/);
  });

  it("fileLinkToPath deshace localFileLink y también el fileUri de Zotero Integration", () => {
    const linux = "/home/testuser/Zotero/storage/K/Marx (2010) - El Capital º.pdf";
    expect(fileLinkToPath(localFileLink(linux))).toBe(linux);
    expect(fileLinkToPath("file:///home/testuser/a%20b.pdf")).toBe("/home/testuser/a b.pdf");
    expect(fileLinkToPath("file:///C:/Users/Ana/a%20b.pdf", "win32")).toBe("C:\\Users\\Ana\\a b.pdf");
    expect(fileLinkToPath("file://C:/Users/Ana/a%20b.pdf", "win32")).toBe("C:\\Users\\Ana\\a b.pdf");
    expect(fileLinkToPath(localFileLink("C:\\Z\\x y.pdf"), "win32")).toBe("C:\\Z\\x y.pdf");
    expect(fileLinkToPath("https://a.b/c")).toBeNull();
    expect(fileLinkToPath("zotero://open/library/items/X")).toBeNull();
  });
});

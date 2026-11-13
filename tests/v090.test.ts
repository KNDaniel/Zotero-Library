// @vitest-environment jsdom
import moment from "moment";
import { beforeAll, describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { childNodes, kindOf, pathExpression, previewOf, rootNodes, searchNodes, templateVariable, valueText } from "../src/explorer/tree";
import { DEFAULT_IMAGE_NAME_TEMPLATE, itemContext, standaloneAnnotationContext, type ContextOptions } from "../src/template/context";
import { defaultTemplateEntries, safeFileName } from "../src/template/defaultNotes";
import { DEFAULT_ANNOTATION_RENDER, DEFAULT_ITEM_RENDER, DEFAULT_PRINT_ANNOTATIONS, DEFAULT_PRINT_FULL, DEFAULT_PRINT_META } from "../src/template/defaults";
import { TemplateEngine, type MomentFn } from "../src/template/engine";
import { ROW_FORMATS } from "../src/template/rowFormats";
import { DataExplorer, EXPLORER_PAGE, PICKER_LIMIT, type ExplorerSource } from "../src/ui/explorer";
import { annotation, attachment, item } from "./fixtures";
import { installObsidianDom } from "./obsidianDom";

beforeAll(() => installObsidianDom(window as unknown as Window & typeof globalThis));

const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });
const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
const opts: ContextOptions = { dataDir: "C:/Z", imagesFolder: "Recursos/Img. Titulos", imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE, renderString: (t, c) => engine.render(t, c) };

const index = LibraryIndex.fromRaw({
  entities: [
    item("CAPITAL1", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867" }, { parsedDate: "1867" }),
    attachment("ATTCAP01", "CAPITAL1"),
    annotation("ANNA0001", "ATTCAP01", { annotationSortIndex: "00001|000001|00001", annotationText: "mercancía", annotationComment: "clave", tags: [{ tag: "Tomo I", type: 0 }] }),
    annotation("ANNA0002", "ATTCAP01", { annotationSortIndex: "00002|000001|00001", annotationText: "valor" }),
  ],
  collections: [],
  libraryVersion: 1,
  total: 0,
  truncated: false,
});

describe("explorador: rutas y valores", () => {
  it("escribe rutas como las entiende Nunjucks", () => {
    expect(pathExpression(["title"])).toBe("title");
    expect(pathExpression(["annotations", 0, "comment"])).toBe("annotations[0].comment");
    expect(pathExpression(["fields", "Short Title"])).toBe('fields["Short Title"]');
    expect(templateVariable(["raw", "data", "url"])).toBe("{{ raw.data.url }}");
  });

  it("clasifica y resume los valores en una línea", () => {
    expect(kindOf(undefined)).toBe("empty");
    expect(kindOf(null)).toBe("null");
    expect(kindOf([])).toBe("array");
    expect(kindOf({})).toBe("object");
    expect(previewOf(undefined)).toBe("(vacío)");
    expect(previewOf([1, 2, 3])).toBe("[3]");
    expect(previewOf({ a: 1, b: 2 })).toBe("{2}");
    expect(previewOf("uno\n  dos")).toBe('"uno dos"');
    expect(previewOf("x".repeat(200), 20)).toBe(`"${"x".repeat(19)}…"`);
  });

  it("la raíz y los hijos salen ordenados por nombre y los de una lista, en orden", () => {
    const roots = rootNodes({ zeta: 1, Alfa: { b: 1, a: 2 }, lista: ["x", "y"] });
    expect(roots.map((n) => n.label)).toEqual(["Alfa", "lista", "zeta"]);
    expect(childNodes(roots[0]).map((n) => n.label)).toEqual(["a", "b"]);
    const kids = childNodes(roots[1]);
    expect(kids.map((n) => pathExpression(n.path))).toEqual(["lista[0]", "lista[1]"]);
  });
});

describe("explorador: texto de un valor", () => {
  it("copia el texto completo sin comillas ni recortes", () => {
    expect(valueText("x".repeat(300))).toBe("x".repeat(300));
    expect(valueText("uno\ndos")).toBe("uno\ndos");
    expect(valueText(1867)).toBe("1867");
    expect(valueText(true)).toBe("true");
    expect(valueText(null)).toBe("null");
    expect(valueText(undefined)).toBe("");
    expect(valueText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(valueText(["x"])).toBe('[\n  "x"\n]');
  });

  it("un objeto circular no rompe la copia", () => {
    const a: Record<string, unknown> = {};
    a.yo = a;
    expect(() => valueText(a)).not.toThrow();
  });
});

describe("explorador: búsqueda", () => {
  const ctx = { title: "El Capital", authors: "Karl Marx", annotations: [{ comment: "Reflexión sobre la mercancía" }, { comment: "otro" }] };

  it("busca por ruta o por valor, sin mayúsculas ni tildes, con todas las palabras", () => {
    expect(searchNodes(ctx, "REFLEXION").nodes.map((n) => pathExpression(n.path))).toEqual(["annotations[0].comment"]);
    expect(searchNodes(ctx, "comment otro").nodes.map((n) => pathExpression(n.path))).toEqual(["annotations[1].comment"]);
    expect(searchNodes(ctx, "marx").nodes.map((n) => n.label)).toEqual(["authors"]);
    expect(searchNodes(ctx, "").nodes).toEqual([]);
  });

  it("limita las coincidencias y lo avisa", () => {
    const big = { lista: Array.from({ length: 50 }, (_, i) => ({ v: `dato ${i}` })) };
    const r = searchNodes(big, "dato", { limit: 10 });
    expect(r.nodes).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it("no se pierde con referencias circulares", () => {
    const a: Record<string, unknown> = { nombre: "a" };
    a.yo = a;
    expect(() => searchNodes({ a }, "nombre")).not.toThrow();
  });

  it("encuentra campos de un contexto real de ítem y de anotación", () => {
    const it = index.entry("CAPITAL1")!;
    const all = index.annotationsOf("CAPITAL1");
    const itemCtx = itemContext(index, it, all, all, opts);
    expect(searchNodes(itemCtx, "firstAuthorSurname").nodes.map((n) => pathExpression(n.path))).toContain("firstAuthorSurname");
    const annCtx = standaloneAnnotationContext(index, index.annotations.get("ANNA0001")!, opts, 7);
    expect(searchNodes(annCtx, "annotation.comment").nodes.map((n) => pathExpression(n.path))).toContain("annotation.comment");
    expect(annCtx.index).toBe(7);
  });
});

describe("plantillas por defecto como notas", () => {
  const entries = defaultTemplateEntries();

  it("ofrece ítem, anotación, tres de impresión y los formatos de fila incluidos", () => {
    expect(entries.map((e) => e.id)).toEqual(["item", "annotation", "printFull", "printMeta", "printAnnotations", ...ROW_FORMATS.map((f) => `row:${f.id}`)]);
    expect(entries.filter((e) => e.group === "Impresión")).toHaveLength(3);
  });

  it("el contenido es exactamente el de la plantilla por defecto", () => {
    const by = Object.fromEntries(entries.map((e) => [e.id, e.source]));
    expect(by.item).toBe(DEFAULT_ITEM_RENDER);
    expect(by.annotation).toBe(DEFAULT_ANNOTATION_RENDER);
    expect(by.printFull).toBe(DEFAULT_PRINT_FULL);
    expect(by.printMeta).toBe(DEFAULT_PRINT_META);
    expect(by.printAnnotations).toBe(DEFAULT_PRINT_ANNOTATIONS);
    for (const f of ROW_FORMATS) expect(by[`row:${f.id}`]).toBe(f.source);
  });

  it("los nombres son únicos, terminan en .md y no llevan caracteres prohibidos", () => {
    const names = entries.map((e) => e.fileName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n.endsWith("(por defecto).md")).toBe(true);
      expect(n).not.toMatch(/[\\/:*?"<>|#^[\]]/);
    }
    expect(names).toContain("Plantilla ítem (por defecto).md");
    expect(names).toContain("Plantilla anotación (por defecto).md");
    expect(safeFileName('a/b:c?"d"')).toBe("a-b-c--d-");
  });

  it("cada plantilla volcada se puede usar: renderiza igual que la incluida", () => {
    const it = index.entry("CAPITAL1")!;
    const all = index.annotationsOf("CAPITAL1");
    const iCtx = itemContext(index, it, all, all, opts);
    const aCtx = standaloneAnnotationContext(index, index.annotations.get("ANNA0001")!, opts, 1);
    const ctxOf = (id: string) => (id === "annotation" ? aCtx : iCtx);
    for (const e of entries) {
      expect(() => engine.render(e.source, ctxOf(e.id), e.fileName)).not.toThrow();
    }
    expect(engine.render(entries[0].source, iCtx)).toBe(engine.render(DEFAULT_ITEM_RENDER, iCtx));
  });
});

/** Fuente falsa para el explorador. */
function fakeSource(): ExplorerSource {
  return {
    itemLabel: (k) => `ITEM ${k}`,
    itemContext: (k) => (k === "NADA" ? null : { title: "El Capital", authors: "Karl Marx", fields: { "Short Title": "Capital" }, annotations: Array.from({ length: EXPLORER_PAGE + 20 }, (_, i) => ({ comment: `c${i}` })) }),
    libraryItems: () => [
      { key: "ZETA0001", label: "Zeta (2001) — Último" },
      { key: "CAPITAL1", label: "Marx (1867) — El Capital" },
      { key: "HEGEL001", label: "Hegel (1807) — Fenomenología del espíritu" },
      { key: "ALFA0001", label: "Alfa (1900) — Ñandú y acción" },
    ],
    itemKeyOfAnnotation: () => "CAPITAL1",
  };
}
const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const rowOf = (root: HTMLElement, path: string) => root.querySelector(`.zl-ex-row[data-path='${path}']`) as HTMLElement;

describe("explorador: interfaz", () => {
  function open(start: { kind: "item" | "annotation"; key: string; selectedKeys?: string[] }, source = fakeSource()) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const copied: string[] = [];
    const kinds: string[] = [];
    const ex = new DataExplorer(parent, source, (t, what) => void (copied.push(t), kinds.push(what)), start);
    return { parent, ex, copied, kinds };
  }

  it("muestra las variables de primer nivel y copia {{ variable }} con un clic", () => {
    const { parent, copied } = open({ kind: "item", key: "CAPITAL1" });
    const labels = [...parent.querySelectorAll(".zl-ex-tree > .zl-ex-node > .zl-ex-row .zl-ex-key")].map((e) => e.textContent);
    expect(labels).toEqual(["annotations", "authors", "fields", "title"]);
    click(rowOf(parent, "title"));
    expect(copied).toEqual(["{{ title }}"]);
    expect(parent.querySelector(".zl-ex-head")!.textContent).toBe("ITEM CAPITAL1");
  });

  it("clic en el nombre copia la variable; clic en el valor copia solo el valor", () => {
    const { parent, copied, kinds } = open({ kind: "item", key: "CAPITAL1" });
    click(rowOf(parent, "title").querySelector(".zl-ex-key")!);
    expect(copied).toEqual(["{{ title }}"]);
    expect(kinds).toEqual(["variable"]);
    click(rowOf(parent, "title").querySelector(".zl-ex-val")!);
    expect(copied).toEqual(["{{ title }}", "El Capital"]); // sin comillas, y sin copiar también la variable
    expect(kinds).toEqual(["variable", "valor"]);
  });

  it("el valor de un objeto o lista se copia como JSON y el de un texto largo, completo", () => {
    const long = "palabra ".repeat(60).trim();
    const source: ExplorerSource = { ...fakeSource(), itemContext: () => ({ largo: long, fields: { a: 1 } }) };
    const { parent, copied } = open({ kind: "item", key: "X" }, source);
    expect(rowOf(parent, "largo").querySelector(".zl-ex-val")!.textContent!.length).toBeLessThan(long.length); // la vista se recorta
    click(rowOf(parent, "largo").querySelector(".zl-ex-val")!);
    click(rowOf(parent, "fields").querySelector(".zl-ex-val")!);
    expect(copied).toEqual([long, '{\n  "a": 1\n}']);
  });

  it("en los resultados de búsqueda también se distingue nombre y valor", () => {
    const { parent, copied, kinds } = open({ kind: "item", key: "CAPITAL1" });
    type(parent.querySelector(".zl-ex-search") as HTMLInputElement, "karl");
    const row = parent.querySelector(".zl-ex-row.is-flat")!;
    click(row.querySelector(".zl-ex-val")!);
    click(row.querySelector(".zl-ex-key")!);
    expect(copied).toEqual(["Karl Marx", "{{ authors }}"]);
    expect(kinds).toEqual(["valor", "variable"]);
  });

  it("si hay texto seleccionado a mano, el clic no copia", () => {
    const { parent, copied } = open({ kind: "item", key: "CAPITAL1" });
    const val = rowOf(parent, "title").querySelector(".zl-ex-val")!;
    const range = document.createRange();
    range.selectNodeContents(val);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    click(val);
    click(rowOf(parent, "title").querySelector(".zl-ex-key")!);
    expect(copied).toEqual([]);
    sel.removeAllRanges();
    click(val);
    expect(copied).toEqual(["El Capital"]);
  });

  it("el triángulo despliega los hijos (solo se dibujan al abrir) y no copia", () => {
    const { parent, copied } = open({ kind: "item", key: "CAPITAL1" });
    expect(parent.querySelector(".zl-ex-children")).toBeNull();
    const toggle = rowOf(parent, "fields").querySelector(".zl-ex-toggle")!;
    click(toggle);
    expect(copied).toEqual([]);
    expect(parent.querySelector(".zl-ex-children")!.classList.contains("is-hidden")).toBe(false); // visibles al primer clic
    expect(toggle.textContent).toBe("▾");
    expect(rowOf(parent, 'fields["Short Title"]')).toBeTruthy();
    click(rowOf(parent, 'fields["Short Title"]'));
    expect(copied).toEqual(['{{ fields["Short Title"] }}']);
    click(toggle); // plegar
    expect(parent.querySelector(".zl-ex-children")!.classList.contains("is-hidden")).toBe(true);
    expect(toggle.textContent).toBe("▸");
    click(toggle); // volver a desplegar
    expect(parent.querySelector(".zl-ex-children")!.classList.contains("is-hidden")).toBe(false);
  });

  it("las listas largas se dibujan por páginas con «Mostrar más»", () => {
    const { parent } = open({ kind: "item", key: "CAPITAL1" });
    click(rowOf(parent, "annotations").querySelector(".zl-ex-toggle")!);
    expect(parent.querySelectorAll(".zl-ex-children > .zl-ex-node").length).toBe(EXPLORER_PAGE);
    click(parent.querySelector(".zl-ex-more")!);
    expect(parent.querySelectorAll(".zl-ex-children > .zl-ex-node").length).toBe(EXPLORER_PAGE + 20);
    expect(parent.querySelector(".zl-ex-more")).toBeNull();
    expect(rowOf(parent, "annotations[119].comment") ?? null).toBeNull(); // los nietos no se dibujan hasta abrir
  });

  it("el buscador lista coincidencias con su ruta completa", () => {
    const { parent, copied } = open({ kind: "item", key: "CAPITAL1" });
    type(parent.querySelector(".zl-ex-search") as HTMLInputElement, "karl");
    const rows = [...parent.querySelectorAll(".zl-ex-row.is-flat")];
    expect(rows.map((r) => r.getAttribute("data-path"))).toEqual(["authors"]);
    click(rows[0]);
    expect(copied).toEqual(["{{ authors }}"]);
    type(parent.querySelector(".zl-ex-search") as HTMLInputElement, "zzzz");
    expect(parent.querySelector(".zl-ex-note")!.textContent).toBe("Sin coincidencias.");
    type(parent.querySelector(".zl-ex-search") as HTMLInputElement, "");
    expect(parent.querySelectorAll(".zl-ex-tree > .zl-ex-node").length).toBe(4);
  });

  it("no hay pestañas de modo: siempre se ven todas las variables del ítem, sin `annotation` ni `index`", () => {
    const { parent } = open({ kind: "item", key: "CAPITAL1" });
    expect(parent.querySelector(".zl-ex-bar")).toBeNull();
    expect(parent.querySelector(".zl-seg")).toBeNull();
    expect(parent.querySelector(".zl-ex-ann")).toBeNull();
    const roots = [...parent.querySelectorAll(".zl-ex-tree > .zl-ex-node > .zl-ex-row .zl-ex-key")].map((e) => e.textContent);
    expect(roots).not.toContain("annotation");
    expect(roots).not.toContain("index");
    expect(roots).toContain("annotations");
  });

  it("al abrirlo desde una anotación se explora su ítem completo", () => {
    const { parent } = open({ kind: "annotation", key: "A2" });
    expect(parent.querySelector(".zl-ex-head")!.textContent).toBe("ITEM CAPITAL1");
    expect(rowOf(parent, "annotations")).toBeTruthy();
    expect(rowOf(parent, "annotation") ?? null).toBeNull();
  });

  describe("selector de ítem", () => {
    const pickerOf = () => {
      const all = document.querySelectorAll(".zl-float-explorer");
      return all[all.length - 1] as HTMLElement;
    };
    const itemsOf = () => [...pickerOf().querySelectorAll(".zl-ex-pick-item")].map((e) => e.textContent);

    it("el botón muestra el ítem actual y abre un desplegable con toda la biblioteca", () => {
      const { parent } = open({ kind: "item", key: "CAPITAL1" });
      const btn = parent.querySelector(".zl-ex-pick")!;
      expect(btn.textContent).toContain("ITEM CAPITAL1");
      expect(pickerOf().classList.contains("is-hidden")).toBe(true);
      click(btn);
      expect(pickerOf().classList.contains("is-hidden")).toBe(false);
      expect(itemsOf()).toHaveLength(4);
    });

    it("los seleccionados van primero y el resto por nombre", () => {
      const { parent } = open({ kind: "item", key: "CAPITAL1", selectedKeys: ["ZETA0001", "HEGEL001"] });
      click(parent.querySelector(".zl-ex-pick")!);
      expect(itemsOf()).toEqual(["Hegel (1807) — Fenomenología del espíritu", "Zeta (2001) — Último", "Alfa (1900) — Ñandú y acción", "Marx (1867) — El Capital"]);
      expect([...pickerOf().querySelectorAll(".zl-ex-pick-item.is-selected-item")]).toHaveLength(2);
      expect(pickerOf().querySelector(".is-current")!.textContent).toContain("Marx");
    });

    it("el buscador filtra sin distinguir mayúsculas ni tildes y con varias palabras", () => {
      const { parent } = open({ kind: "item", key: "CAPITAL1" });
      click(parent.querySelector(".zl-ex-pick")!);
      const input = pickerOf().querySelector<HTMLInputElement>(".zl-ex-pick-search")!;
      type(input, "nandu");
      expect(itemsOf()).toEqual(["Alfa (1900) — Ñandú y acción"]);
      type(input, "FENOMENOLOGIA espiritu");
      expect(itemsOf()).toEqual(["Hegel (1807) — Fenomenología del espíritu"]);
      type(input, "zzz");
      expect(itemsOf()).toEqual([]);
      expect(pickerOf().textContent).toContain("Ningún ítem coincide");
    });

    it("elegir un ítem cambia el árbol, vacía el buscador de variables y cierra el desplegable", () => {
      const { parent } = open({ kind: "item", key: "CAPITAL1" });
      type(parent.querySelector(".zl-ex-search") as HTMLInputElement, "karl");
      click(parent.querySelector(".zl-ex-pick")!);
      const hegel = [...pickerOf().querySelectorAll(".zl-ex-pick-item")].find((e) => e.textContent!.startsWith("Hegel"))!;
      hegel.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      expect(parent.querySelector(".zl-ex-head")!.textContent).toBe("ITEM HEGEL001");
      expect((parent.querySelector(".zl-ex-search") as HTMLInputElement).value).toBe("");
      expect(pickerOf().classList.contains("is-hidden")).toBe(true);
      expect(parent.querySelectorAll(".zl-ex-tree > .zl-ex-node").length).toBe(4);
    });

    it("un clic fuera cierra el desplegable y destroy lo retira del documento", () => {
      const { parent, ex } = open({ kind: "item", key: "CAPITAL1" });
      click(parent.querySelector(".zl-ex-pick")!);
      document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
      expect(pickerOf().classList.contains("is-hidden")).toBe(true);
      const el = pickerOf();
      ex.destroy();
      expect(document.body.contains(el)).toBe(false);
    });

    it("con una biblioteca grande solo se listan los primeros y se avisa", () => {
      const many = Array.from({ length: PICKER_LIMIT + 50 }, (_, i) => ({ key: `K${i}`, label: `Ítem ${String(i).padStart(4, "0")}` }));
      const { parent } = open({ kind: "item", key: "K1" }, { ...fakeSource(), libraryItems: () => many });
      click(parent.querySelector(".zl-ex-pick")!);
      expect(itemsOf()).toHaveLength(PICKER_LIMIT);
      expect(pickerOf().textContent).toContain(`Se muestran ${PICKER_LIMIT} de ${PICKER_LIMIT + 50}`);
      type(pickerOf().querySelector<HTMLInputElement>(".zl-ex-pick-search")!, "0249");
      expect(itemsOf()).toEqual(["Ítem 0249"]);
    });
  });

  it("un ítem sin datos muestra un aviso en vez de un árbol vacío", () => {
    const { parent } = open({ kind: "item", key: "NADA" });
    expect(parent.querySelector(".zl-empty")!.textContent).toContain("No hay datos");
  });
});

// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import type { OutputRequest, OutputScope } from "../src/output/build";
import type { OutputAction } from "../src/output/OutputService";
import type { ZoteroItem } from "../src/model/types";
import { ItemsPanel, itemLabel } from "../src/ui/ItemsPanel";
import { CHUNK, ResultsPanel, type CardRenderer } from "../src/ui/ResultsPanel";
import { defaultViewState, derive, toggleInList, type ViewState } from "../src/ui/state";
import { TagsPanel } from "../src/ui/TagsPanel";
import { VirtualList } from "../src/ui/VirtualList";
import { annotation, attachment, collection, item } from "./fixtures";
import { installObsidianDom } from "./obsidianDom";

beforeAll(() => installObsidianDom(window as unknown as Window & typeof globalThis));

const au = (first: string, last: string) => ({ creatorType: "author", firstName: first, lastName: last });

function sampleIndex(extraAnnotations = 0): LibraryIndex {
  const extra = Array.from({ length: extraAnnotations }, (_, i) =>
    annotation(`EXTRA${String(i).padStart(3, "0")}`, "ATTCAP01", { annotationSortIndex: `00010|${String(i).padStart(6, "0")}|00001`, tags: [{ tag: `t${i % 5}`, type: 0 }] }),
  );
  return LibraryIndex.fromRaw({
    entities: [
      item("CAPITAL1", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867", collections: ["COLMARX"] }, { parsedDate: "1867" }),
      item("FENOMEN1", { title: "Fenomenología del espíritu", creators: [au("Georg", "Hegel")], date: "1807", collections: ["COLSUB01"] }, { parsedDate: "1807" }),
      item("SINANOT1", { title: "Sin anotaciones", creators: [au("Ana", "Zeta")], date: "1999" }, { parsedDate: "1999" }),
      attachment("ATTCAP01", "CAPITAL1"),
      attachment("ATTFEN01", "FENOMEN1"),
      annotation("ANNA0001", "ATTCAP01", { annotationSortIndex: "00001|000001|00001", tags: [{ tag: "Tomo I", type: 0 }, { tag: "mercancía", type: 0 }] }),
      annotation("ANNA0002", "ATTCAP01", { annotationSortIndex: "00002|000001|00001", tags: [{ tag: "Tomo I", type: 0 }] }),
      annotation("ANNF0001", "ATTFEN01", { tags: [{ tag: "espíritu", type: 0 }] }),
      ...extra,
    ],
    collections: [collection("COLMARX", "Marx"), collection("COLHEGEL", "Hegel"), collection("COLSUB01", "Hegel sub", "COLHEGEL")],
    libraryVersion: 1,
    total: 0,
    truncated: false,
  });
}

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const fakeRenderer: CardRenderer = {
  item: async (body, i) => body.setText(`ITEM ${i.title}`),
  annotation: async (body, a, pos) => body.setText(`ANN ${pos} ${a.key}`),
};

/** Monta los tres paneles con el mismo ciclo que la vista real. */
function harness(index: LibraryIndex, initial: Partial<ViewState> = {}, renderer: CardRenderer = fakeRenderer) {
  const localCalls: string[] = [];
  const root = document.createElement("div");
  document.body.appendChild(root);
  const state: ViewState = { ...defaultViewState(), ...initial };
  let pending: Promise<void> = Promise.resolve();
  const refresh = (): Promise<void> => {
    const d = derive(index, state);
    state.selectedItems = d.selectedItems;
    state.markedItems = d.markedItems;
    state.markedAnnotations = d.markedAnnotations;
    state.selectedTags = [...d.selectedTags];
    items.update(d);
    tags.update(d);
    pending = results.update(d, state, renderer);
    return pending;
  };
  const outputCalls: Array<{ action: string; request: OutputRequest; scope: OutputScope }> = [];
  const exploreCalls: Array<{ kind: string; key: string }> = [];
  let outputResult: string | Error = "hecho";
  const host = {
    state: () => state,
    patch: (p: Partial<ViewState>) => {
      Object.assign(state, p);
      void refresh();
    },
    index: () => index,
    setMarks: (marks: Partial<Pick<ViewState, "markedItems" | "markedAnnotations">>) => void Object.assign(state, marks),
    explore: (kind: "item" | "annotation", key: string) => void exploreCalls.push({ kind, key }),
    toggleTag: (t: string) => host.patch({ selectedTags: toggleInList(state.selectedTags, t) }),
    templateNames: () => ["print/completa.md", "render/item.md"],
    rowLabel: (item: ZoteroItem) => itemLabel(item),
    onItemMenu: () => undefined,
    openLocal: (p: string) => void localCalls.push(p),
    runOutput: async (action: OutputAction, request: OutputRequest, scope: OutputScope) => {
      outputCalls.push({ action, request, scope });
      if (outputResult instanceof Error) throw outputResult;
      return outputResult;
    },
  };
  const items = new ItemsPanel(root, host);
  const tags = new TagsPanel(root, host);
  const results = new ResultsPanel(root, host);
  void refresh();
  return { root, state, items, tags, results, host, outputCalls, localCalls, exploreCalls, failOutput: (e: Error) => (outputResult = e), settle: async () => pending };
}

/** Filas de ítems de la lista principal (sin las de la sección «Seleccionados») */
const mainRows = (root: HTMLElement) => [...root.querySelectorAll(".zl-items .zl-item-row:not(.in-selected-section)")];
/** «Todos | Ninguno»: ahora junto a «Y | O» (segundo selector del grupo de la derecha de la búsqueda) */
const pickSeg = (root: HTMLElement) => root.querySelectorAll(".zl-items .zl-search-modes .zl-actions .zl-seg")[1]!;
/** El desplegable de colecciones del último panel creado (los anteriores de otras pruebas quedan en el <body>) */
/** «Seleccionados» arranca plegado: esta función pulsa su cabecera para ver sus filas */
const expandSelected = async (h: { root: HTMLElement; settle: () => Promise<void> }) => {
  click(h.root.querySelector(".zl-items .zl-group-row.is-selected")!);
  await h.settle();
};
const collMenu = () => (() => { const all = document.querySelectorAll(".zl-float-collections"); return all[all.length - 1] as HTMLElement; })();
const rows = (root: HTMLElement, panel: string) => [...root.querySelectorAll(`.${panel} .zl-vrow`)];
const text = (el: Element | null) => el?.textContent ?? "";

describe("VirtualList", () => {
  it("solo dibuja una ventana de filas y la actualiza al desplazarse", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const list = new VirtualList<number>(parent, { rowHeight: 20, overscan: 2, renderRow: (row, n) => row.setText(String(n)) });
    list.setItems(Array.from({ length: 5000 }, (_, i) => i));
    const drawn = parent.querySelectorAll(".zl-vrow").length;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(40); // no 5000
    expect(text(parent.querySelector(".zl-vrow"))).toBe("0");
    list.el.scrollTop = 20 * 1000;
    list.el.dispatchEvent(new window.Event("scroll"));
    const first = Number(text(parent.querySelector(".zl-vrow")));
    expect(first).toBeGreaterThan(900);
    expect(list.length).toBe(5000);
  });
});

describe("panel de ítems", () => {
  it("lista los ítems disponibles ordenados por autor y cuenta la selección", () => {
    const h = harness(sampleIndex());
    expect(mainRows(h.root).map((r) => text(r.querySelector(".zl-item-label")))).toEqual([
      "Hegel (1807) — Fenomenología del espíritu",
      "Marx (1867) — El Capital",
      "Zeta (1999) — Sin anotaciones",
    ]);
    expect(text(h.root.querySelector(".zl-items .zl-count"))).toBe("0 seleccionados de 3");
  });

  it("marcar un ítem lo selecciona; «Todos» y «Ninguno» funcionan y marcan su estado", async () => {
    const h = harness(sampleIndex());
    click(mainRows(h.root)[1]);
    await h.settle();
    expect(h.state.selectedItems).toEqual(["CAPITAL1"]);
    expect(text(h.root.querySelector(".zl-items .zl-count"))).toBe("1 seleccionado de 3");
    expect(mainRows(h.root)[1].classList.contains("is-selected")).toBe(true);

    // «Todos» y «Ninguno» usan el diseño segmentado, sin tooltip y sin botones sueltos
    const seg = pickSeg(h.root);
    const buttons = [...seg.querySelectorAll("button")];
    expect(buttons.map(text)).toEqual(["Todos", "Ninguno"]);
    expect(buttons.every((b) => !b.hasAttribute("title"))).toBe(true);
    expect(h.root.querySelectorAll(".zl-items .zl-panel-head .zl-btn")).toHaveLength(0);
    expect(buttons.map((b) => b.classList.contains("is-active"))).toEqual([false, false]); // 1 de 3: ninguna activa

    click(buttons[0]);
    await h.settle();
    expect(h.state.selectedItems).toHaveLength(3);
    expect(buttons.map((b) => b.classList.contains("is-active"))).toEqual([true, false]);
    click(buttons[1]);
    await h.settle();
    expect(h.state.selectedItems).toEqual([]);
    expect(buttons.map((b) => b.classList.contains("is-active"))).toEqual([false, true]);
  });

  it("la búsqueda rápida filtra al escribir y la selección sobrevive", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    type(h.root.querySelector(".zl-simple input") as HTMLInputElement, "@autor: Hegel");
    await h.settle();
    expect(mainRows(h.root)).toHaveLength(1);
    expect(h.state.selectedItems.sort()).toEqual(["CAPITAL1", "FENOMEN1"]); // el ítem oculto sigue seleccionado
    expect(text(h.root.querySelector(".zl-items .zl-count"))).toContain("1 fuera de la búsqueda");
    expect(h.root.querySelectorAll(".zl-item-row.in-selected-section")).toHaveLength(0); // plegado por defecto
    await expandSelected(h);
    expect(h.root.querySelectorAll(".zl-item-row.in-selected-section")).toHaveLength(2);
    type(h.root.querySelector(".zl-simple input") as HTMLInputElement, "@inventado: x");
    expect(text(h.root.querySelector(".zl-warnings"))).toContain("inventado");
  });

  it("«Todos» suma los disponibles a los ya seleccionados y «Ninguno» quita también los ocultos", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    type(h.root.querySelector(".zl-simple input") as HTMLInputElement, "@autor: Hegel");
    await h.settle();
    const buttons = [...pickSeg(h.root).querySelectorAll("button")];
    click(buttons[0]); // «Todos»: los disponibles (Hegel) se suman a CAPITAL1, que está oculto
    await h.settle();
    expect([...h.state.selectedItems].sort()).toEqual(["CAPITAL1", "FENOMEN1"]);
    click(buttons[1]); // «Ninguno»
    await h.settle();
    expect(h.state.selectedItems).toEqual([]);
  });

  it("colecciones: árbol con subcolecciones y límite por colección", async () => {
    const h = harness(sampleIndex());
    // El árbol vive en un desplegable flotante que se abre con el botón «Colecciones»
    expect(collMenu().classList.contains("is-hidden")).toBe(true);
    click(h.root.querySelector(".zl-coll-btn")!);
    expect(collMenu().classList.contains("is-hidden")).toBe(false);
    expect(collMenu().querySelectorAll(".zl-tree-row")).toHaveLength(2); // Hegel (con hijo plegado) y Marx
    click(collMenu().querySelector(".zl-chevron")!); // despliega «Hegel»
    expect(collMenu().querySelectorAll(".zl-tree-row")).toHaveLength(3);
    const hegel = collMenu().querySelectorAll<HTMLInputElement>(".zl-tree-row input")[0];
    hegel.checked = true;
    hegel.dispatchEvent(new window.Event("change", { bubbles: true }));
    await h.settle();
    expect(h.state.collections).toEqual(["COLHEGEL"]);
    expect(mainRows(h.root).map((r) => text(r.querySelector(".zl-item-label")))).toEqual(["Hegel (1807) — Fenomenología del espíritu"]);
    expect(text(h.root.querySelector(".zl-coll-label"))).toContain("1 elegidas");
    expect(collMenu().classList.contains("is-hidden")).toBe(false); // sigue abierto para elegir varias

    const sub = collMenu().querySelector("input[type=checkbox]") as HTMLInputElement;
    sub.checked = false; // sin subcolecciones: el ítem está en la subcolección
    sub.dispatchEvent(new window.Event("change", { bubbles: true }));
    await h.settle();
    expect(mainRows(h.root)).toHaveLength(0);

    // Un clic fuera lo cierra
    document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(collMenu().classList.contains("is-hidden")).toBe(true);
  });

  it("modo complejo: se rellena desde la búsqueda simple y filtra por filas", async () => {
    const h = harness(sampleIndex(), { searchText: "@autor: Marx" });
    const segs = [...h.root.querySelectorAll(".zl-search-modes .zl-seg")][0].querySelectorAll("button");
    click(segs[1]); // Compleja
    await h.settle();
    expect(h.state.searchMode).toBe("complex");
    expect(h.state.complexConditions).toHaveLength(1);
    expect(h.state.complexConditions[0]).toMatchObject({ field: "author", op: "contains", value: "Marx" });
    expect(mainRows(h.root)).toHaveLength(1);

    // añadir una fila: año < 1850 con O
    click([...h.root.querySelectorAll(".zl-complex .zl-btn")].find((b) => text(b) === "+ Añadir condición")!);
    const condRows = h.root.querySelectorAll(".zl-cond");
    expect(condRows).toHaveLength(2);
    const second = condRows[1];
    type(second.querySelector(".zl-cond-field") as HTMLInputElement, "año");
    const op = second.querySelector(".zl-cond-op") as HTMLSelectElement;
    op.value = "lt";
    op.dispatchEvent(new window.Event("change", { bubbles: true }));
    type(second.querySelectorAll<HTMLInputElement>(".zl-cond-value")[0], "1850");
    expect(h.state.complexConditions[1]).toMatchObject({ field: "year", op: "lt", value: "1850" });
    expect(mainRows(h.root)).toHaveLength(0); // Y: Marx y anterior a 1850 no existe

    const combine = [...h.root.querySelectorAll(".zl-search-modes .zl-seg")][1].querySelectorAll("button");
    click(combine[1]); // O
    await h.settle();
    expect(h.state.combine).toBe("or");
    expect(mainRows(h.root)).toHaveLength(2); // Marx o anterior a 1850
    // escribir en una fila no la reconstruye (conserva el foco)
    expect(h.root.querySelectorAll(".zl-cond")[1]).toBe(second);

    click(second.querySelector(".zl-btn")!); // ✕
    expect(h.state.complexConditions).toHaveLength(1);
  });
});

describe("panel de etiquetas", () => {
  it("sin ítems seleccionados no muestra etiquetas", () => {
    const h = harness(sampleIndex());
    expect(text(h.root.querySelector(".zl-tags .zl-empty"))).toContain("Selecciona ítems");
    expect(rows(h.root, "zl-tags")).toHaveLength(0);
  });

  it("con ítems muestra las etiquetas de sus anotaciones con recuento; marcar filtra", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    const names = () => rows(h.root, "zl-tags").map((r) => `${text(r.querySelector(".zl-tag-name"))}:${text(r.querySelector(".zl-tag-count"))}`);
    expect(names()).toEqual(["mercancía:1", "Tomo I:2"]);
    expect(h.root.querySelector(".zl-tags .zl-empty")!.classList.contains("is-hidden")).toBe(true);

    click(rows(h.root, "zl-tags")[1]); // Tomo I
    await h.settle();
    expect(h.state.selectedTags).toEqual(["Tomo I"]);
    expect(names()[0]).toBe("Tomo I:2"); // las elegidas primero
    expect(text(h.root.querySelector(".zl-chip"))).toContain("Tomo I");
    expect(h.results.renderedCards).toBe(1); // modo ítem: una tarjeta por ítem

    click(h.root.querySelector(".zl-chip")!); // quitar con el chip
    expect(h.state.selectedTags).toEqual([]);
  });

  it("buscador sin tildes y conmutador Y/O", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    type(h.root.querySelector(".zl-tags input[type=search]") as HTMLInputElement, "ESPIRITU");
    await h.settle();
    expect(rows(h.root, "zl-tags").map((r) => text(r.querySelector(".zl-tag-name")))).toEqual(["espíritu"]);
    const seg = h.root.querySelector(".zl-tags .zl-seg")!.querySelectorAll("button");
    click(seg[1]);
    expect(h.state.tagMatch).toBe("any");
  });

  it("al deseleccionar los ítems se vacía el panel y se descartan las etiquetas elegidas", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], selectedTags: ["Tomo I"] });
    expect(h.state.selectedTags).toEqual(["Tomo I"]);
    h.host.patch({ selectedItems: [] });
    await h.settle();
    expect(h.state.selectedTags).toEqual([]);
    expect(rows(h.root, "zl-tags")).toHaveLength(0);
  });
});

describe("panel de resultados", () => {
  it("sin selección muestra una invitación; con ítems, una tarjeta por ítem (también sin anotaciones)", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    expect(text(h.root.querySelector(".zl-results .zl-empty"))).toContain("Selecciona uno o más ítems");
    h.host.patch({ selectedItems: ["CAPITAL1", "SINANOT1"] });
    await h.settle();
    expect([...h.root.querySelectorAll(".zl-card .zl-card-body")].map(text).sort()).toEqual(["ITEM El Capital", "ITEM Sin anotaciones"]);
    expect(h.root.querySelectorAll(".zl-badges")).toHaveLength(0); // modo ítem: sin insignias
  });

  it("los botones Copiar/Insertar son lo último de cada tarjeta, debajo de las insignias", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation" });
    await h.settle();
    const cards = [...h.root.querySelectorAll<HTMLElement>(".zl-card")];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.lastElementChild!.classList.contains("zl-card-actions")).toBe(true);
      const badges = c.querySelector(".zl-badges");
      if (badges) expect(badges.compareDocumentPosition(c.querySelector(".zl-card-actions")!) & 4).toBeTruthy(); // 4 = viene después
    }
    expect(h.root.querySelectorAll(".zl-badges").length).toBeGreaterThan(0); // la prueba cubre tarjetas con insignias

    h.host.patch({ mode: "item" });
    await h.settle();
    for (const c of h.root.querySelectorAll<HTMLElement>(".zl-card")) expect(c.lastElementChild!.classList.contains("zl-card-actions")).toBe(true);
  });

  it("modo anotación: tarjetas con color, posición e insignias (de)seleccionables", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation" });
    await h.settle();
    const cards = [...h.root.querySelectorAll<HTMLElement>(".zl-card")];
    expect(cards.map((c) => text(c.querySelector(".zl-card-body")))).toEqual(["ANN 1 ANNF0001", "ANN 2 ANNA0001", "ANN 3 ANNA0002"]);
    expect(cards[1].style.borderLeftColor).not.toBe("");
    expect(text(h.root.querySelector(".zl-results .zl-count"))).toBe("3 anotaciones");

    const badge = [...h.root.querySelectorAll(".zl-badge")].find((b) => text(b) === "Tomo I")!;
    click(badge);
    await h.settle();
    expect(h.state.selectedTags).toEqual(["Tomo I"]);
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(2); // solo las que llevan Tomo I
    expect(text(h.root.querySelector(".zl-results .zl-count"))).toBe("2 de 3 anotaciones");
    expect([...h.root.querySelectorAll(".zl-badge")].find((b) => text(b) === "Tomo I")!.classList.contains("is-selected")).toBe(true);
  });

  it("orden, dirección y agrupación", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation" });
    await h.settle();
    h.host.patch({ annotationGroup: "item", annotationSort: { key: "page", dir: "desc" } });
    await h.settle();
    expect([...h.root.querySelectorAll(".zl-group")].map(text)).toEqual(["Fenomenología del espíritu (1)", "El Capital (2)"]);
    expect([...h.root.querySelectorAll(".zl-card-body")].map(text)).toEqual(["ANN 1 ANNF0001", "ANN 2 ANNA0002", "ANN 3 ANNA0001"]); // la posición sigue el orden mostrado

    // los controles del otro modo están ocultos
    const sorts = h.root.querySelectorAll(".zl-results .zl-toolbar select");
    expect(sorts[0].classList.contains("is-hidden")).toBe(true); // orden de ítems
    expect(sorts[1].classList.contains("is-hidden")).toBe(false);
    click([...h.root.querySelectorAll(".zl-results .zl-toolbar .zl-btn")][0]);
    expect(h.state.annotationSort.dir).toBe("asc");
  });

  it("el modo se cambia con el conmutador", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    click(h.root.querySelectorAll(".zl-results .zl-panel-head .zl-seg button")[1]);
    await h.settle();
    expect(h.state.mode).toBe("annotation");
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(2);
  });

  it("muchas tarjetas se dibujan por lotes con «Mostrar más»", async () => {
    const h = harness(sampleIndex(70), { selectedItems: ["CAPITAL1"], mode: "annotation" });
    await h.settle();
    expect(h.results.renderedCards).toBe(CHUNK);
    const more = h.root.querySelector(".zl-more .zl-btn")!;
    expect(text(more)).toBe(`Mostrar más (${72 - CHUNK} restantes)`);
    click(more);
    await h.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.results.renderedCards).toBe(CHUNK * 2);
    expect(h.root.querySelectorAll(".zl-more")).toHaveLength(1);
  });

  it("agrupar por etiqueta repite la anotación en cada una de sus etiquetas", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation", annotationGroup: "tag" });
    await h.settle();
    expect([...h.root.querySelectorAll(".zl-group")].map(text)).toEqual(["mercancía (1)", "Tomo I (2)"]);
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(3);
  });
});

describe("barra de salida y botones de cada tarjeta", () => {
  const outBtn = (root: HTMLElement, label: string) => [...root.querySelectorAll(".zl-output .zl-btn")].find((b) => text(b) === label) as HTMLButtonElement;
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("ofrece los cinco tipos de salida y recuerda la elección", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    const kind = h.root.querySelector(".zl-output select") as HTMLSelectElement;
    expect([...kind.options].map((o) => o.text)).toEqual(["Metadata + anotaciones", "Solo metadata", "Solo anotaciones", "Bibliografía", "Enlace Markdown"]);
    kind.value = "meta";
    kind.dispatchEvent(new window.Event("change", { bubbles: true }));
    await h.settle();
    expect(h.state.outputKind).toBe("meta");
  });

  it("la plantilla se elige entre las de la carpeta y el estilo solo aparece con la bibliografía", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    const tpl = h.root.querySelector(".zl-output-template") as HTMLSelectElement;
    expect([...tpl.options].map((o) => o.value)).toEqual(["", "print/completa.md", "render/item.md"]);
    tpl.value = "print/completa.md";
    tpl.dispatchEvent(new window.Event("change", { bubbles: true }));
    await h.settle();
    expect(h.state.outputTemplates.full).toBe("print/completa.md");
    expect(h.state.outputTemplates.bibliography).toBe("");
    expect(h.root.querySelector(".zl-output-style")!.classList.contains("is-hidden")).toBe(true);
    h.host.patch({ outputKind: "bibliography" });
    await h.settle();
    expect(h.root.querySelector(".zl-output-style")!.classList.contains("is-hidden")).toBe(false);
    type(h.root.querySelector(".zl-output-style input") as HTMLInputElement, "iso690-author-date-es");
    expect(h.state.outputStyle).toBe("iso690-author-date-es");
  });

  it("los botones están desactivados sin ítems seleccionados", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    expect(outBtn(h.root, "Copiar").disabled).toBe(true);
    h.host.patch({ selectedItems: ["CAPITAL1"] });
    await h.settle();
    expect(outBtn(h.root, "Copiar").disabled).toBe(false);
  });

  it("copiar, insertar y nueva nota piden la salida con la configuración actual y muestran el resumen", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], outputKind: "meta", outputTemplates: { full: "", meta: "print/completa.md", annotations: "", bibliography: "", link: "" }, outputStyle: "apa" });
    await h.settle();
    click(outBtn(h.root, "Copiar"));
    await flush();
    expect(h.outputCalls[0]).toEqual({ action: "copy", request: { kind: "meta", mode: "item", template: "print/completa.md", style: "apa" }, scope: { type: "all" } });
    expect(text(h.root.querySelector(".zl-output-status"))).toBe("✓ hecho");
    click(outBtn(h.root, "Insertar en la nota"));
    click(outBtn(h.root, "Nueva nota"));
    await flush();
    expect(h.outputCalls.map((c) => c.action)).toEqual(["copy", "insert", "note"]);
  });

  it("un error se muestra junto a los botones sin romper nada", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    await h.settle();
    h.failOutput(new Error("No hay ninguna nota abierta"));
    click(outBtn(h.root, "Insertar en la nota"));
    await flush();
    const st = h.root.querySelector(".zl-output-status")!;
    expect(text(st)).toBe("⚠️ No hay ninguna nota abierta");
    expect(st.classList.contains("is-error")).toBe(true);
  });

  it("cada tarjeta tiene sus botones: un ítem usa el tipo elegido; una anotación, «solo anotaciones»", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], outputKind: "annotations", outputTemplates: { full: "", meta: "", annotations: "render/item.md", bibliography: "", link: "" } });
    await h.settle();
    click([...h.root.querySelectorAll(".zl-card .zl-card-actions .zl-btn")].find((b) => text(b) === "Copiar")!);
    await flush();
    // «solo anotaciones» no tiene sentido para un ítem entero: se usa «metadata + anotaciones» con SU plantilla (no la de anotaciones)
    expect(h.outputCalls[0]).toEqual({ action: "copy", request: { kind: "full", mode: "item", template: "", style: "" }, scope: { type: "item", key: "CAPITAL1" } });

    h.host.patch({ mode: "annotation", outputKind: "meta", outputTemplates: { full: "", meta: "render/item.md", annotations: "print/completa.md", bibliography: "", link: "" } });
    await h.settle();
    click([...h.root.querySelectorAll(".zl-card .zl-card-actions .zl-btn")].find((b) => text(b) === "Insertar")!);
    await flush();
    const last = h.outputCalls[h.outputCalls.length - 1];
    expect(last.action).toBe("insert");
    expect(last.request).toEqual({ kind: "annotations", mode: "annotation", template: "print/completa.md", style: "" }); // la plantilla de «solo anotaciones», no la de metadata
    expect(last.scope.type).toBe("annotation");
  });
});

describe("la plantilla se recuerda por tipo de salida", () => {
  it("cambiar de tipo no arrastra la plantilla del anterior", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    const tpl = h.root.querySelector(".zl-output-template") as HTMLSelectElement;
    tpl.value = "print/completa.md";
    tpl.dispatchEvent(new window.Event("change", { bubbles: true }));
    await h.settle();
    h.host.patch({ outputKind: "bibliography" });
    await h.settle();
    expect((h.root.querySelector(".zl-output-template") as HTMLSelectElement).value).toBe("");
    click([...h.root.querySelectorAll(".zl-output .zl-btn")].find((b) => text(b) === "Copiar")!);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.outputCalls[0].request).toEqual({ kind: "bibliography", mode: "item", template: "", style: "" });
    h.host.patch({ outputKind: "full" });
    await h.settle();
    expect((h.root.querySelector(".zl-output-template") as HTMLSelectElement).value).toBe("print/completa.md");
  });
});


/** Índice con adjuntos sin contenedor: un PDF suelto y otro con el padre ausente. */
function indexWithLooseAttachments(): LibraryIndex {
  return LibraryIndex.fromRaw({
    entities: [
      item("ITEMAAAA", { title: "El Capital", creators: [au("Karl", "Marx")], date: "1867", collections: ["COL1"] }, { parsedDate: "1867" }),
      item("ITEMBBBB", { title: "Fenomenología", creators: [au("Georg", "Hegel")], date: "1807" }, { parsedDate: "1807" }),
      attachment("ATTAAAAA", "ITEMAAAA"),
      attachment("SOLO0001", null, { filename: "suelto.pdf" }),
      attachment("ORPH0001", "FALTAPAD", { filename: "huerfano.pdf" }),
      annotation("A1AAAAAA", "ATTAAAAA", { annotationText: "La clase obrera lucha", annotationComment: "", annotationSortIndex: "00001|000001|00001", tags: [{ tag: "x", type: 0 }, { tag: "y", type: 0 }] }),
      annotation("A2AAAAAA", "ATTAAAAA", { annotationText: "Burguesía y capital", annotationComment: "", annotationSortIndex: "00002|000001|00001", tags: [{ tag: "x", type: 0 }] }),
      annotation("A3AAAAAA", "ATTAAAAA", { annotationText: "otra cosa", annotationComment: "", annotationSortIndex: "00003|000001|00001", tags: [{ tag: "y", type: 0 }, { tag: "z", type: 0 }] }),
      annotation("S1SSSSSS", "SOLO0001", { annotationText: "nota del pdf suelto", annotationComment: "", tags: [{ tag: "x", type: 0 }] }),
    ],
    collections: [collection("COL1", "Colección uno")],
    libraryVersion: 1,
    total: 0,
    truncated: false,
  });
}

const headers = (root: HTMLElement) => [...root.querySelectorAll(".zl-items .zl-group-row")].map((r) => text(r.querySelector(".zl-group-label")));
const listRowsText = (root: HTMLElement) => [...root.querySelectorAll(".zl-items .zl-vrow")].map((r) => (r.classList.contains("zl-group-row") ? `[${text(r.querySelector(".zl-group-label"))}]` : text(r.querySelector(".zl-item-label"))));

describe("lista de ítems: secciones, adjuntos sin contenedor y opciones", () => {
  it("muestra los adjuntos sin contenedor al final, con su etiqueta, y se pueden seleccionar", async () => {
    const h = harness(indexWithLooseAttachments());
    await h.settle();
    expect(listRowsText(h.root)).toEqual(["Hegel (1807) — Fenomenología", "Marx (1867) — El Capital", "[Adjuntos sin contenedor]", "huerfano.pdf", "suelto.pdf"]);
    expect([...h.root.querySelectorAll(".zl-items .zl-row-tag")].map(text)).toEqual(["adjunto", "adjunto"]);
    const loose = [...h.root.querySelectorAll(".zl-items .zl-item-row")].find((r) => text(r.querySelector(".zl-item-label")) === "suelto.pdf")!;
    click(loose);
    await h.settle();
    expect(h.state.selectedItems).toEqual(["SOLO0001"]);
    expect(h.state.mode).toBe("item");
    // sus anotaciones llegan a las etiquetas y, en modo anotación, a los resultados
    expect(rows(h.root, "zl-tags").map((r) => text(r.querySelector(".zl-tag-name")))).toEqual(["x"]);
    h.host.patch({ mode: "annotation" });
    await h.settle();
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(1);
    expect(text(h.root.querySelector(".zl-card-body"))).toContain("S1SSSSSS");
  });

  it("las tarjetas de ítem de un adjunto sin contenedor llevan un aviso", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["SOLO0001", "ITEMAAAA"] });
    await h.settle();
    const notes = [...h.root.querySelectorAll(".zl-results .zl-attachment-note")];
    expect(notes).toHaveLength(1);
    expect(text(notes[0])).toContain("Adjunto sin contenedor");
  });

  it("«Todos» incluye también los adjuntos sin contenedor", async () => {
    const h = harness(indexWithLooseAttachments());
    await h.settle();
    click(pickSeg(h.root).querySelectorAll("button")[0]);
    await h.settle();
    expect(h.state.selectedItems.sort()).toEqual(["ITEMAAAA", "ITEMBBBB", "ORPH0001", "SOLO0001"]);
    expect(text(h.root.querySelector(".zl-items .zl-count"))).toBe("4 seleccionados de 4");
  });

  it("«Seleccionados» sube arriba de todo, empieza plegado y se despliega al pulsar su cabecera", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"] });
    await h.settle();
    expect(listRowsText(h.root).slice(0, 2)).toEqual(["[Seleccionados]", "Hegel (1807) — Fenomenología"]); // la cabecera, y a continuación la lista normal
    expect(h.root.querySelectorAll(".zl-items .in-selected-section")).toHaveLength(0);
    expect(text(h.root.querySelector(".zl-items .zl-group-row .zl-chevron"))).toBe("▸");
    expect(text(h.root.querySelector(".zl-items .zl-group-row .zl-tag-count"))).toBe("1"); // el recuento se ve aun plegado
    click(h.root.querySelector(".zl-items .zl-group-row")!);
    await h.settle();
    expect(listRowsText(h.root).slice(0, 3)).toEqual(["[Seleccionados]", "Marx (1867) — El Capital", "Hegel (1807) — Fenomenología"]);
    expect(h.root.querySelectorAll(".zl-items .in-selected-section")).toHaveLength(1);
    expect(text(h.root.querySelector(".zl-items .zl-group-row .zl-chevron"))).toBe("▾");
    expect(h.state.selectedItems).toEqual(["ITEMAAAA"]); // plegar no deselecciona
    click(h.root.querySelector(".zl-items .zl-group-row")!);
    expect(h.root.querySelectorAll(".zl-items .in-selected-section")).toHaveLength(0);
  });

  it("los grupos de la lista son plegables y el grupo de adjuntos también", async () => {
    const h = harness(indexWithLooseAttachments(), { listGroup: "year" });
    await h.settle();
    expect(headers(h.root)).toEqual(["1807", "1867", "Adjuntos sin contenedor"]);
    const attachments = [...h.root.querySelectorAll(".zl-items .zl-group-row")].find((r) => text(r.querySelector(".zl-group-label")) === "Adjuntos sin contenedor")!;
    click(attachments);
    expect(listRowsText(h.root)).toEqual(["[1807]", "Hegel (1807) — Fenomenología", "[1867]", "Marx (1867) — El Capital", "[Adjuntos sin contenedor]"]);
  });

  it("orden, agrupación y formato de la lista son independientes de los de resultados", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA", "ITEMBBBB"] });
    await h.settle();
    const [sortSel, groupSel, formatSel] = [...h.root.querySelectorAll(".zl-items .zl-list-opts select")] as HTMLSelectElement[];
    sortSel.value = "title";
    sortSel.dispatchEvent(new window.Event("change"));
    expect(h.state.listSort).toEqual({ key: "title", dir: "asc" });
    expect(h.state.itemSort.key).toBe("author"); // el de resultados no cambia
    click(h.root.querySelector(".zl-items .zl-list-opts .zl-btn")!);
    expect(h.state.listSort.dir).toBe("desc");
    groupSel.value = "collection";
    groupSel.dispatchEvent(new window.Event("change"));
    expect(h.state.listGroup).toBe("collection");
    expect(h.state.itemGroup).toBe("none");
    formatSel.value = "builtin:title";
    formatSel.dispatchEvent(new window.Event("change"));
    expect(h.state.rowFormat).toBe("builtin:title");
  });

  it("el selector de formato ofrece los incluidos y las plantillas de la carpeta", async () => {
    const h = harness(indexWithLooseAttachments());
    await h.settle();
    const sel = h.root.querySelector(".zl-items .zl-row-format") as HTMLSelectElement;
    const labels = [...sel.options].map((o) => o.text);
    expect(labels[0]).toBe("Por defecto");
    expect(labels).toContain("Autor (Año) — Título");
    expect(labels).toContain("Solo Título");
    expect(labels).toContain("Plantilla: print/completa.md");
    expect([...sel.options].find((o) => o.text === "Solo Título")!.value).toBe("builtin:title");
  });
});

describe("etiquetas: contadores y contenedor plegable", () => {
  it("los contadores bajan con Y al elegir etiquetas y ocultan los ceros", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"] });
    await h.settle();
    const counts = () => Object.fromEntries(rows(h.root, "zl-tags").map((r) => [text(r.querySelector(".zl-tag-name")), text(r.querySelector(".zl-tag-count"))]));
    expect(counts()).toEqual({ x: "2", y: "2", z: "1" }); // sin elegir: el total
    click(rows(h.root, "zl-tags").find((r) => text(r.querySelector(".zl-tag-name")) === "z")!);
    await h.settle();
    expect(counts()).toEqual({ z: "1", y: "1" }); // con Y y «z»: solo A3 (y, z); «x» queda a 0 y se oculta
  });

  it("con O los contadores no cambian al elegir etiquetas", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"], tagMatch: "any" });
    await h.settle();
    click(rows(h.root, "zl-tags").find((r) => text(r.querySelector(".zl-tag-name")) === "z")!);
    await h.settle();
    const counts = Object.fromEntries(rows(h.root, "zl-tags").map((r) => [text(r.querySelector(".zl-tag-name")), text(r.querySelector(".zl-tag-count"))]));
    expect(counts).toEqual({ z: "1", x: "2", y: "2" }); // totales: O ni restringe ni agrega
  });

  it("el contenedor de etiquetas elegidas aparece al elegir, empieza desplegado y se pliega", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"] });
    await h.settle();
    const chosen = h.root.querySelector(".zl-tags .zl-chosen") as HTMLElement;
    expect(chosen.classList.contains("is-hidden")).toBe(true);
    click(rows(h.root, "zl-tags").find((r) => text(r.querySelector(".zl-tag-name")) === "x")!);
    await h.settle();
    expect(chosen.classList.contains("is-hidden")).toBe(false);
    expect(text(chosen.querySelector(".zl-chosen-head"))).toBe("▾ Etiquetas elegidas (1)");
    expect(chosen.querySelector(".zl-chips")!.classList.contains("is-hidden")).toBe(false);
    click(chosen.querySelector(".zl-chosen-head")!);
    expect(text(chosen.querySelector(".zl-chosen-head"))).toBe("▸ Etiquetas elegidas (1)");
    expect(chosen.querySelector(".zl-chips")!.classList.contains("is-hidden")).toBe(true);
    expect(h.state.selectedTags).toEqual(["x"]); // plegar no quita la etiqueta
  });

  it("las etiquetas elegidas suben al principio de la lista", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"] });
    await h.settle();
    click(rows(h.root, "zl-tags").find((r) => text(r.querySelector(".zl-tag-name")) === "z")!);
    await h.settle();
    expect(text(rows(h.root, "zl-tags")[0].querySelector(".zl-tag-name"))).toBe("z");
    expect(rows(h.root, "zl-tags")[0].classList.contains("is-selected")).toBe(true);
  });
});

describe("resultados: búsqueda de contenido", () => {
  const annotated: CardRenderer = {
    item: async (body, i) => body.setText(`ITEM ${i.title}`),
    annotation: async (body, a) => body.setText(a.text),
  };

  it("escribir filtra las anotaciones (todas las palabras; | alternativas) y no toca la selección de ítems", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"], mode: "annotation" }, annotated);
    await h.settle();
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(3);
    type(h.root.querySelector(".zl-content-search input") as HTMLInputElement, "clase obrera | burguesia");
    await h.settle();
    expect(h.state.contentSearch).toBe("clase obrera | burguesia");
    expect([...h.root.querySelectorAll(".zl-card-body")].map((b) => b.textContent)).toEqual(["La clase obrera lucha", "Burguesía y capital"]);
    expect(text(h.root.querySelector(".zl-results .zl-count"))).toBe("2 de 3 anotaciones");
    expect(h.state.selectedItems).toEqual(["ITEMAAAA"]);
    type(h.root.querySelector(".zl-content-search input") as HTMLInputElement, "clase burguesia");
    await h.settle();
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(0); // todas deben aparecer
    expect(text(h.root.querySelector(".zl-results-body .zl-empty"))).toContain("búsqueda");
  });

  it("resalta las coincidencias en las tarjetas, sin tildes ni mayúsculas", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"], mode: "annotation" }, annotated);
    await h.settle();
    type(h.root.querySelector(".zl-content-search input") as HTMLInputElement, "BURGUESIA | capital");
    await h.settle();
    const marks = [...h.root.querySelectorAll(".zl-card-body mark.zl-hit")].map((m) => m.textContent);
    expect(marks).toEqual(["Burguesía", "capital"]);
    // quitar la búsqueda quita el resaltado
    type(h.root.querySelector(".zl-content-search input") as HTMLInputElement, "");
    await h.settle();
    expect(h.root.querySelectorAll("mark.zl-hit")).toHaveLength(0);
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(3);
  });

  it("el ámbito cambia dónde se busca y los contadores de etiquetas siguen a la búsqueda", async () => {
    const h = harness(indexWithLooseAttachments(), { selectedItems: ["ITEMAAAA"], mode: "annotation" }, annotated);
    await h.settle();
    const scope = h.root.querySelector(".zl-content-search select") as HTMLSelectElement;
    expect([...scope.options].map((o) => o.value)).toEqual(["both", "text", "comment"]);
    scope.value = "comment";
    scope.dispatchEvent(new window.Event("change"));
    type(h.root.querySelector(".zl-content-search input") as HTMLInputElement, "clase");
    await h.settle();
    expect(h.state.contentScope).toBe("comment");
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(0); // «clase» solo está en el texto, no en el comentario
    scope.value = "text";
    scope.dispatchEvent(new window.Event("change"));
    await h.settle();
    expect(h.root.querySelectorAll(".zl-card")).toHaveLength(1);
    const counts = Object.fromEntries(rows(h.root, "zl-tags").map((r) => [text(r.querySelector(".zl-tag-name")), text(r.querySelector(".zl-tag-count"))]));
    expect(counts).toEqual({ x: "1", y: "1" }); // solo cuentan las anotaciones que pasan la búsqueda
  });
});

// ---------------------------------------------------------------------------------------------
// 0.8.0: marcas de tarjetas (doble clic) y grupos de resultados plegables
// ---------------------------------------------------------------------------------------------
const lastCall = <T,>(list: T[]): T => list[list.length - 1];
const dblclick = (el: Element) => el.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
const cardsOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".zl-results .zl-card")];
const cardBody = (root: HTMLElement, key: string) => root.querySelector<HTMLElement>(`.zl-card[data-key="${key}"]`)!;
const marksText = (root: HTMLElement) => text(root.querySelector(".zl-results .zl-marks"));
const outputButton = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLElement>(".zl-results .zl-output .zl-btn")].find((b) => text(b) === label)!;

describe("tarjetas marcadas (doble clic)", () => {
  it("el doble clic marca una tarjeta y otro la desmarca; aparece el contador y el botón para quitarlas", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    await h.settle();
    expect(h.root.querySelector(".zl-results .zl-marks")!.classList.contains("is-hidden")).toBe(true);

    dblclick(cardBody(h.root, "FENOMEN1").querySelector(".zl-card-body")!);
    expect(h.state.markedItems).toEqual(["FENOMEN1"]);
    const card = cardBody(h.root, "FENOMEN1");
    expect(card.classList.contains("is-marked")).toBe(true);
    expect(card.querySelector(".zl-mark-badge")).toBeNull(); // ya no hay insignia de texto: se distingue por el color
    expect(card.querySelector(".zl-card-actions")!.textContent).not.toContain("Marcada");
    expect(cardBody(h.root, "CAPITAL1").classList.contains("is-marked")).toBe(false);
    expect(marksText(h.root)).toContain("1 marcada");

    dblclick(card.querySelector(".zl-card-body")!);
    expect(h.state.markedItems).toEqual([]);
    expect(card.classList.contains("is-marked")).toBe(false);
    expect(h.root.querySelector(".zl-results .zl-marks")!.classList.contains("is-hidden")).toBe(true);
  });

  it("el doble clic sobre insignias, botones y enlaces no marca", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" });
    await h.settle();
    dblclick(h.root.querySelector(".zl-card .zl-badge")!);
    dblclick(h.root.querySelector(".zl-card .zl-card-actions .zl-btn")!);
    expect(h.state.markedAnnotations).toEqual([]);
    dblclick(h.root.querySelector(".zl-card .zl-card-body")!);
    expect(h.state.markedAnnotations).toEqual(["ANNA0001"]);
  });

  it("marcar no redibuja las tarjetas (no se pierde la posición de lectura)", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    await h.settle();
    const before = cardBody(h.root, "CAPITAL1");
    dblclick(before.querySelector(".zl-card-body")!);
    expect(cardBody(h.root, "CAPITAL1")).toBe(before); // el mismo nodo
  });

  it("«Copiar», «Insertar» y «Nueva nota» usan solo las marcadas; sin marcas, todo", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    await h.settle();
    click(outputButton(h.root, "Copiar"));
    await h.settle();
    expect(lastCall(h.outputCalls).scope).toEqual({ type: "all" });

    dblclick(cardBody(h.root, "CAPITAL1").querySelector(".zl-card-body")!);
    for (const [label, action] of [["Copiar", "copy"], ["Insertar en la nota", "insert"], ["Nueva nota", "note"]] as const) {
      click(outputButton(h.root, label));
      expect(lastCall(h.outputCalls).action).toBe(action);
      expect(lastCall(h.outputCalls).scope).toEqual({ type: "marked", mode: "item", items: ["CAPITAL1"], annotations: [] });
    }
    // los botones de cada tarjeta siguen sacando solo esa tarjeta
    click(cardBody(h.root, "FENOMEN1").querySelector(".zl-card-actions .zl-btn")!);
    expect(lastCall(h.outputCalls).scope).toEqual({ type: "item", key: "FENOMEN1" });
  });

  it("«Quitar marcas» las quita todas del modo actual", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    await h.settle();
    for (const c of cardsOf(h.root)) dblclick(c.querySelector(".zl-card-body")!);
    expect(h.state.markedItems).toHaveLength(2);
    expect(marksText(h.root)).toContain("2 marcadas");
    click([...h.root.querySelectorAll(".zl-results .zl-marks .zl-btn")][0]);
    expect(h.state.markedItems).toEqual([]);
    expect(h.root.querySelectorAll(".zl-results .zl-card.is-marked")).toHaveLength(0);
    expect(h.root.querySelector(".zl-results .zl-marks")!.classList.contains("is-hidden")).toBe(true);
  });

  it("las marcas sobreviven a cambiar de modo y de etiquetas; cada modo tiene las suyas", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    await h.settle();
    dblclick(cardBody(h.root, "CAPITAL1").querySelector(".zl-card-body")!); // marca de ítem

    h.host.patch({ mode: "annotation" });
    await h.settle();
    expect(h.root.querySelector(".zl-results .zl-marks")!.classList.contains("is-hidden")).toBe(true); // en este modo no hay marcas
    dblclick(cardBody(h.root, "ANNA0002").querySelector(".zl-card-body")!);
    expect(h.state.markedAnnotations).toEqual(["ANNA0002"]);

    h.host.patch({ selectedTags: ["Tomo I"] }); // la tarjeta se redibuja y sigue marcada
    await h.settle();
    expect(cardBody(h.root, "ANNA0002").classList.contains("is-marked")).toBe(true);

    h.host.patch({ mode: "item", selectedTags: [] });
    await h.settle();
    expect(cardBody(h.root, "CAPITAL1").classList.contains("is-marked")).toBe(true);
    expect(h.state.markedAnnotations).toEqual(["ANNA0002"]);
  });

  it("una marca que los filtros ocultan se conserva, avisa y cuenta igual para la salida", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" });
    await h.settle();
    dblclick(cardBody(h.root, "ANNA0002").querySelector(".zl-card-body")!); // lleva «Tomo I» solamente
    h.host.patch({ selectedTags: ["mercancía"] }); // solo ANNA0001 la lleva
    await h.settle();
    expect(cardsOf(h.root).map((c) => c.getAttribute("data-key"))).toEqual(["ANNA0001"]);
    expect(h.state.markedAnnotations).toEqual(["ANNA0002"]); // sigue guardada
    expect(marksText(h.root)).toContain("1 marcada");
    expect(marksText(h.root)).toContain("no se ve");
    click(outputButton(h.root, "Copiar"));
    expect(lastCall(h.outputCalls).scope).toEqual({ type: "marked", mode: "annotation", items: [], annotations: ["ANNA0002"] });

    h.host.patch({ selectedTags: [] });
    await h.settle();
    expect(cardBody(h.root, "ANNA0002").classList.contains("is-marked")).toBe(true);
    expect(marksText(h.root)).not.toContain("no se ve");
  });

  it("al deseleccionar el ítem se pierden sus marcas", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation" });
    await h.settle();
    dblclick(cardBody(h.root, "ANNA0001").querySelector(".zl-card-body")!);
    dblclick(cardBody(h.root, "ANNF0001").querySelector(".zl-card-body")!);
    h.host.patch({ selectedItems: ["FENOMEN1"] });
    await h.settle();
    expect(h.state.markedAnnotations).toEqual(["ANNF0001"]);
    h.host.patch({ selectedItems: ["CAPITAL1", "FENOMEN1"] }); // la vuelve a seleccionar: la marca no regresa
    await h.settle();
    expect(h.state.markedAnnotations).toEqual(["ANNF0001"]);
    expect(cardBody(h.root, "ANNA0001").classList.contains("is-marked")).toBe(false);
  });
});

describe("grupos de resultados plegables", () => {
  it("el encabezado pliega y despliega el grupo sin quitar nada del resultado", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation", annotationGroup: "item" });
    await h.settle();
    const wraps = [...h.root.querySelectorAll<HTMLElement>(".zl-results .zl-group-wrap")];
    expect(wraps).toHaveLength(2);
    expect(wraps.every((w) => !w.classList.contains("is-collapsed"))).toBe(true); // desplegados por defecto
    const head = wraps[1].querySelector<HTMLElement>(".zl-group")!;
    expect(head.getAttribute("aria-expanded")).toBe("true");

    click(head);
    expect(wraps[1].classList.contains("is-collapsed")).toBe(true);
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(cardsOf(h.root)).toHaveLength(3); // las tarjetas siguen ahí
    expect(text(head)).toBe("El Capital (2)"); // y el encabezado conserva su texto

    click(outputButton(h.root, "Copiar"));
    expect(lastCall(h.outputCalls).scope).toEqual({ type: "all" }); // plegar no excluye nada de la salida

    click(head);
    expect(wraps[1].classList.contains("is-collapsed")).toBe(false);
  });

  it("también se pliega con el teclado", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation", annotationGroup: "item" });
    await h.settle();
    const head = h.root.querySelector<HTMLElement>(".zl-results .zl-group")!;
    head.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(head.parentElement!.classList.contains("is-collapsed")).toBe(true);
  });

  it("el encabezado de un grupo plegado cuenta sus tarjetas marcadas", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation", annotationGroup: "item" });
    await h.settle();
    dblclick(cardBody(h.root, "ANNA0001").querySelector(".zl-card-body")!);
    dblclick(cardBody(h.root, "ANNA0002").querySelector(".zl-card-body")!);
    const head = cardBody(h.root, "ANNA0001").closest(".zl-group-wrap")!.querySelector<HTMLElement>(".zl-group")!;
    expect(head.getAttribute("data-marked")).toContain("2 marcadas");
    expect(text(head)).toBe("El Capital (2)");
  });

  it("sin agrupar no hay grupos y las tarjetas cuelgan directamente del cuerpo", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" });
    await h.settle();
    expect(h.root.querySelectorAll(".zl-results .zl-group-wrap")).toHaveLength(0);
    expect(cardsOf(h.root)).toHaveLength(2);
  });
});

describe("caché de tarjetas de anotación dibujadas", () => {
  /** Renderizador que cuenta cuántas veces dibuja cada anotación; la firma decide si la caché vale. */
  const countingRenderer = (signature: string | undefined) => {
    const calls: string[] = [];
    const renderer: CardRenderer = {
      signature,
      item: async (body, i) => body.setText(`ITEM ${i.title}`),
      annotation: async (body, a, pos) => {
        calls.push(a.key);
        body.setText(`ANN ${pos} ${a.key}`);
      },
    };
    return { renderer, calls };
  };

  it("al reagrupar, las tarjetas ya dibujadas se reutilizan sin volver a pasar por la plantilla", async () => {
    const { renderer, calls } = countingRenderer("sig-1");
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"], mode: "annotation" }, renderer);
    await h.settle();
    expect(calls.sort()).toEqual(["ANNA0001", "ANNA0002", "ANNF0001"]);
    expect(h.results.cachedCards).toBe(0);

    calls.length = 0;
    h.host.patch({ annotationGroup: "color" });
    await h.settle();
    expect(calls).toEqual([]); // nada se dibujó de nuevo
    expect(h.results.cachedCards).toBe(3);
    expect(cardsOf(h.root).map((c) => text(c.querySelector(".zl-card-body")))).toEqual(["ANN 1 ANNF0001", "ANN 2 ANNA0001", "ANN 3 ANNA0002"]);

    calls.length = 0;
    h.host.patch({ annotationGroup: "none" });
    await h.settle();
    expect(calls).toEqual([]);
  });

  it("si cambia la posición de una anotación (otro orden) se vuelve a dibujar, porque la plantilla puede usarla", async () => {
    const { renderer, calls } = countingRenderer("sig-1");
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" }, renderer);
    await h.settle();
    calls.length = 0;
    h.host.patch({ annotationSort: { key: "page", dir: "desc" } });
    await h.settle();
    expect(calls.sort()).toEqual(["ANNA0001", "ANNA0002"]);
    expect(cardsOf(h.root).map((c) => text(c.querySelector(".zl-card-body")))).toEqual(["ANN 1 ANNA0002", "ANN 2 ANNA0001"]);
  });

  it("si cambia la firma (otros datos, plantillas o ajustes) se vacía la caché", async () => {
    const first = countingRenderer("sig-1");
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" }, first.renderer);
    await h.settle();
    const second = countingRenderer("sig-2");
    h.results.update(derive(sampleIndex(), h.state), h.state, second.renderer);
    await h.settle();
    expect(second.calls.sort()).toEqual(["ANNA0001", "ANNA0002"]);
    expect(h.results.cachedCards).toBe(0);
  });

  it("un render antiguo que termina tarde no repuebla la caché después de cambiar la firma", async () => {
    let finishOld!: () => void;
    const oldGate = new Promise<void>((resolve) => { finishOld = resolve; });
    const oldRenderer: CardRenderer = {
      signature: "sig-old",
      item: async () => undefined,
      annotation: async (body) => {
        await oldGate;
        body.setText("CONTENIDO ANTIGUO");
      },
    };
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" }, oldRenderer);
    const oldRender = h.settle();

    const newCalls: string[] = [];
    const newRenderer: CardRenderer = {
      signature: "sig-new",
      item: async () => undefined,
      annotation: async (body, a) => {
        newCalls.push(a.key);
        body.setText(`CONTENIDO NUEVO ${a.key}`);
      },
    };
    const d = derive(sampleIndex(), h.state);
    await h.results.update(d, h.state, newRenderer);
    finishOld();
    await oldRender;

    await h.results.update(d, h.state, newRenderer);
    expect(newCalls).toHaveLength(2);
    expect([...h.root.querySelectorAll(".zl-card-body")].map((el) => el.textContent)).toEqual([
      "CONTENIDO NUEVO ANNA0001",
      "CONTENIDO NUEVO ANNA0002",
    ]);
  });

  it("sin firma no se guarda nada", async () => {
    const { renderer, calls } = countingRenderer(undefined);
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" }, renderer);
    await h.settle();
    calls.length = 0;
    h.host.patch({ annotationGroup: "color" });
    await h.settle();
    expect(calls.sort()).toEqual(["ANNA0001", "ANNA0002"]);
  });

  it("una anotación que sale en varios grupos (por etiqueta) no roba su contenido a la otra copia", async () => {
    const { renderer } = countingRenderer("sig-1");
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" }, renderer);
    await h.settle();
    h.host.patch({ annotationGroup: "tag" }); // ANNA0001 lleva dos etiquetas: sale dos veces
    await h.settle();
    h.host.patch({ annotationGroup: "tag", contentSearch: "" });
    await h.settle();
    const copies = [...h.root.querySelectorAll(".zl-results .zl-card[data-key=\"ANNA0001\"]")];
    expect(copies).toHaveLength(2);
    expect(copies.map((c) => text(c.querySelector(".zl-card-body")))).toEqual(["ANN 1 ANNA0001", "ANN 1 ANNA0001"]);
    expect(copies.every((c) => c.querySelector(".zl-card-body") !== null)).toBe(true);
  });

  it("las marcas de una tarjeta reutilizada se pintan en su tarjeta, no en el contenido guardado", async () => {
    const { renderer } = countingRenderer("sig-1");
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" }, renderer);
    await h.settle();
    dblclick(cardBody(h.root, "ANNA0002").querySelector(".zl-card-body")!);
    h.host.patch({ annotationGroup: "color" });
    await h.settle();
    expect(cardBody(h.root, "ANNA0002").classList.contains("is-marked")).toBe(true);
    expect(cardBody(h.root, "ANNA0001").classList.contains("is-marked")).toBe(false);
  });
});


describe("0.9.0: «Por defecto» explícito y botón Datos", () => {
  it("el selector de plantilla de salida empieza por «Por defecto»", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    const sel = h.root.querySelector(".zl-results .zl-select-template, .zl-results select") as HTMLSelectElement | null;
    const all = [...h.root.querySelectorAll(".zl-results select")] as HTMLSelectElement[];
    const withDefault = all.find((x) => x.options[0]?.text === "Por defecto" && x.options[0].value === "");
    expect(sel === null || !!sel).toBe(true);
    expect(withDefault).toBeTruthy();
    expect([...withDefault!.options].map((o) => o.text)).toContain("print/completa.md");
  });

  it("cada tarjeta lleva un botón «Datos» que abre el explorador con su clave", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "item" });
    await h.settle();
    const btn = [...h.root.querySelectorAll(".zl-card .zl-card-actions .zl-btn")].find((b) => text(b) === "Datos")!;
    expect(btn).toBeTruthy();
    click(btn);
    expect(h.exploreCalls).toEqual([{ kind: "item", key: "CAPITAL1" }]);
  });

  it("en modo anotaciones el botón «Datos» abre la anotación", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" });
    await h.settle();
    const card = h.root.querySelector('.zl-card[data-key="ANNA0001"]')!;
    click([...card.querySelectorAll(".zl-card-actions .zl-btn")].find((b) => text(b) === "Datos")!);
    expect(h.exploreCalls).toEqual([{ kind: "annotation", key: "ANNA0001" }]);
  });

  it("«Datos» es el último botón y «Copiar» sigue siendo el primero", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "item" });
    await h.settle();
    const labels = [...h.root.querySelectorAll(".zl-card .zl-card-actions .zl-btn")].map((b) => text(b));
    expect(labels[0]).toBe("Copiar");
    expect(labels[labels.length - 1]).toBe("Datos");
  });
});

describe("0.9.3: panel de ítems", () => {
  const headerOf = (root: HTMLElement, id: string) => [...root.querySelectorAll<HTMLElement>(".zl-items .zl-group-row")].find((r) => r.classList.contains(`is-${id}`));
  const check = (row: HTMLElement) => row.querySelector<HTMLInputElement>(".zl-group-check")!;

  it("la búsqueda dice solo «Buscar…», sin ayuda debajo, y el «?» muestra la sintaxis", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    const input = h.root.querySelector<HTMLInputElement>(".zl-items .zl-simple input")!;
    expect(input.placeholder).toBe("Buscar…");
    expect(h.root.querySelector(".zl-items .zl-hint")).toBeNull();
    const help = h.root.querySelector(".zl-items .zl-simple .zl-help-btn")!;
    const box = () => [...document.querySelectorAll<HTMLElement>(".zl-float-help")].filter((e) => (e.textContent ?? "").includes("Sintaxis de la búsqueda")).pop()!;
    expect(box().classList.contains("is-hidden")).toBe(true);
    click(help);
    expect(box().classList.contains("is-hidden")).toBe(false);
    expect(box().textContent).toContain("@campo: valor");
    expect(box().textContent).toContain("@año: 1850-1900");
    expect(box().textContent).toContain("XIX");
    click(help);
    expect(box().classList.contains("is-hidden")).toBe(true);
  });

  it("la búsqueda de contenido también dice «Buscar…» y lleva su «?»", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    expect((h.root.querySelector(".zl-content-search input") as HTMLInputElement).placeholder).toBe("Buscar…");
    expect(h.root.querySelector(".zl-content-search .zl-help-btn")).not.toBeNull();
  });

  it("«Todos | Ninguno» quedan a la derecha de «Y | O»", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    const segs = [...h.root.querySelectorAll(".zl-items .zl-search-modes .zl-actions .zl-seg")];
    expect(segs.map((s) => [...s.querySelectorAll("button")].map(text))).toEqual([["Y", "O"], ["Todos", "Ninguno"]]);
    expect(h.root.querySelector(".zl-items .zl-panel-head .zl-seg")).toBeNull();
  });

  it("cada fila muestra el total de anotaciones del ítem y lo oculta si es 0", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    const countOf = (title: string) => {
      const row = mainRows(h.root).find((r) => text(r.querySelector(".zl-item-label")).includes(title))!;
      return row.querySelector(".zl-ann-count");
    };
    expect(text(countOf("El Capital"))).toBe("2");
    expect(text(countOf("Fenomenología"))).toBe("1");
    expect(countOf("Sin anotaciones")).toBeNull();
  });

  it("el total de anotaciones no depende de los filtros de etiquetas", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], selectedTags: ["mercancía"] });
    await h.settle();
    const row = mainRows(h.root).find((r) => text(r.querySelector(".zl-item-label")).includes("El Capital"))!;
    expect(text(row.querySelector(".zl-ann-count"))).toBe("2");
  });

  it("la casilla de la cabecera de grupo selecciona o quita todos los ítems del grupo (tres estados)", async () => {
    const h = harness(sampleIndex(), { listGroup: "collection" });
    await h.settle();
    const groups = [...h.root.querySelectorAll<HTMLElement>(".zl-items .zl-group-row.is-group")];
    const marx = groups.find((g) => text(g.querySelector(".zl-group-label")) === "Marx")!;
    expect(check(marx).checked).toBe(false);
    expect(check(marx).indeterminate).toBe(false);

    click(check(marx)); // todos los del grupo
    await h.settle();
    expect(h.state.selectedItems).toEqual(["CAPITAL1"]);
    const marx2 = [...h.root.querySelectorAll<HTMLElement>(".zl-items .zl-group-row.is-group")].find((g) => text(g.querySelector(".zl-group-label")) === "Marx")!;
    expect(check(marx2).checked).toBe(true);

    click(check(marx2)); // ninguno
    await h.settle();
    expect(h.state.selectedItems).toEqual([]);
  });

  it("la casilla de grupo muestra el estado intermedio y el clic en el nombre sigue plegando", async () => {
    const h = harness(sampleIndex(), { listGroup: "itemType", selectedItems: ["CAPITAL1"] });
    await h.settle();
    const group = [...h.root.querySelectorAll<HTMLElement>(".zl-items .zl-group-row.is-group")][0]!;
    expect(check(group).checked).toBe(false);
    expect(check(group).indeterminate).toBe(true); // 1 de 3
    click(group.querySelector(".zl-group-label")!);
    expect(h.root.querySelectorAll(".zl-items .zl-group-row.is-group .zl-chevron")[0]!.textContent).toBe("▸");
    expect(h.state.selectedItems).toEqual(["CAPITAL1"]); // plegar no cambia la selección
  });

  it("un ítem que está en varios grupos queda seleccionado en todos", async () => {
    const idx = LibraryIndex.fromRaw({
      entities: [item("MULTI001", { title: "En dos colecciones", creators: [au("A", "B")], date: "2000", collections: ["COLMARX", "COLHEGEL"] }, { parsedDate: "2000" })],
      collections: [collection("COLMARX", "Marx"), collection("COLHEGEL", "Hegel")],
      libraryVersion: 1, total: 0, truncated: false,
    });
    const h = harness(idx, { listGroup: "collection" });
    await h.settle();
    const first = [...h.root.querySelectorAll<HTMLElement>(".zl-items .zl-group-row.is-group")][0]!;
    click(check(first));
    await h.settle();
    for (const g of h.root.querySelectorAll<HTMLElement>(".zl-items .zl-group-row.is-group")) expect(check(g).checked).toBe(true);
  });

  it("la casilla de «Seleccionados» está siempre marcada y al pulsarla quita toda la selección", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    await h.settle();
    const sel = headerOf(h.root, "selected")!;
    expect(check(sel).checked).toBe(true);
    click(check(sel));
    await h.settle();
    expect(h.state.selectedItems).toEqual([]);
  });

  it("la casilla de grupo actúa solo sobre los ítems disponibles del grupo", async () => {
    const h = harness(sampleIndex(), { listGroup: "itemType", searchText: "@autor: Marx" });
    await h.settle();
    click(check([...h.root.querySelectorAll<HTMLElement>(".zl-items .zl-group-row.is-group")][0]!));
    await h.settle();
    expect(h.state.selectedItems).toEqual(["CAPITAL1"]);
  });

  it("el último ítem de «Seleccionados» lleva el separador", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1", "FENOMEN1"] });
    await h.settle();
    await expandSelected(h);
    const inSel = [...h.root.querySelectorAll(".zl-items .zl-item-row.in-selected-section")];
    expect(inSel.map((r) => r.classList.contains("is-section-last"))).toEqual([false, true]);
  });

  it("el clic derecho sobre un ítem pide el menú de ese ítem", async () => {
    const h = harness(sampleIndex());
    await h.settle();
    const calls: string[] = [];
    (h.host as unknown as { onItemMenu: (i: ZoteroItem) => void }).onItemMenu = (i) => calls.push(i.key);
    const row = mainRows(h.root).find((r) => text(r.querySelector(".zl-item-label")).includes("El Capital"))!;
    const ev = new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    row.dispatchEvent(ev);
    expect(calls).toEqual(["CAPITAL1"]);
    expect(ev.defaultPrevented).toBe(true);
    expect(h.state.selectedItems).toEqual([]); // el clic derecho no selecciona
  });

  it("búsqueda compleja: el campo ofrece una lista flotante de campos y elegir uno lo rellena", async () => {
    const h = harness(sampleIndex(), { searchMode: "complex", complexConditions: [{ field: "*", op: "contains", value: "", negate: false }] });
    await h.settle();
    const field = h.root.querySelector<HTMLInputElement>(".zl-cond-field")!;
    expect(field.hasAttribute("list")).toBe(false); // ya no es un datalist nativo
    field.dispatchEvent(new window.Event("focus"));
    const all = document.querySelectorAll(".zl-float-suggest");
    const box = all[all.length - 1] as HTMLElement;
    expect(box.classList.contains("is-hidden")).toBe(false);
    const options = [...box.querySelectorAll(".zl-suggest-item")];
    expect(options.length).toBeGreaterThan(3);
    type(field, "aut");
    const filtered = [...(document.querySelectorAll(".zl-float-suggest")[document.querySelectorAll(".zl-float-suggest").length - 1] as HTMLElement).querySelectorAll(".zl-suggest-item")].map(text);
    expect(filtered.every((f) => f.toLowerCase().includes("aut"))).toBe(true);
    const pick = [...document.querySelectorAll(".zl-float-suggest")].pop()!.querySelector(".zl-suggest-item")!;
    pick.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await h.settle();
    expect(field.value).toBe(text(pick));
  });
});

describe("0.9.4: tarjetas y salidas", () => {
  it("la tarjeta de una anotación lleva su color en --zl-card-color (tiñe el fondo al marcarla)", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" });
    await h.settle();
    const card = cardBody(h.root, "ANNA0001");
    expect(card.style.getPropertyValue("--zl-card-color")).toBe("#ffd400");
    dblclick(card.querySelector(".zl-card-body")!);
    expect(card.classList.contains("is-marked")).toBe(true);
  });

  it("cada tarjeta tiene un botón «ID» que copia la clave con la plantilla de ID", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    await h.settle();
    const idBtn = [...cardBody(h.root, "CAPITAL1").querySelectorAll(".zl-card-actions button")].find((b) => text(b) === "ID")!;
    expect(idBtn).toBeDefined();
    click(idBtn);
    await h.settle();
    expect(h.outputCalls[0]).toEqual({ action: "copy", request: { kind: "link", mode: "item", template: "builtin:id", style: "" }, scope: { type: "item", key: "CAPITAL1" } });
  });

  it("en modo anotaciones el botón «ID» de la tarjeta pide la clave de esa anotación", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation" });
    await h.settle();
    const idBtn = [...cardBody(h.root, "ANNA0001").querySelectorAll(".zl-card-actions button")].find((b) => text(b) === "ID")!;
    click(idBtn);
    await h.settle();
    expect(h.outputCalls[0]).toEqual({ action: "copy", request: { kind: "link", mode: "annotation", template: "builtin:id", style: "" }, scope: { type: "annotation", key: "ANNA0001" } });
  });

  it("con «Enlace Markdown» la lista de plantillas trae las cinco incluidas y las de «Copiar» usan ese tipo", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], outputKind: "link" });
    await h.settle();
    const tpl = h.root.querySelector(".zl-output-template") as HTMLSelectElement;
    expect([...tpl.options].map((o) => o.text).slice(0, 6)).toEqual(["Por defecto", "Título → seleccionar", "Título → abrir", "Solo select", "Solo open", "ID"]);
    tpl.value = "builtin:only-open";
    tpl.dispatchEvent(new window.Event("change", { bubbles: true }));
    await h.settle();
    expect(h.state.outputTemplates.link).toBe("builtin:only-open");
    click([...h.root.querySelectorAll(".zl-output button")].find((b) => text(b) === "Copiar")!);
    await h.settle();
    expect(h.outputCalls[0]!.request).toMatchObject({ kind: "link", template: "builtin:only-open" });
  });

  it("con «Enlace Markdown» los botones de una tarjeta de anotación también sacan enlaces", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"], mode: "annotation", outputKind: "link" });
    await h.settle();
    const copy = [...cardBody(h.root, "ANNA0001").querySelectorAll(".zl-card-actions button")].find((b) => text(b) === "Copiar")!;
    click(copy);
    await h.settle();
    expect(h.outputCalls[0]!.request).toMatchObject({ kind: "link", mode: "annotation" });
    expect(h.outputCalls[0]!.scope).toEqual({ type: "annotation", key: "ANNA0001" });
  });

  it("un clic en un enlace «Local» (file://) de una tarjeta abre el archivo con el sistema y no navega", async () => {
    const h = harness(sampleIndex(), { selectedItems: ["CAPITAL1"] });
    await h.settle();
    const body = h.root.querySelector(".zl-results-body")!;
    const a = document.createElement("a");
    const href = process.platform === "win32"
      ? "file:///C:/Users/ana/Zotero/storage/K/Marx%20%282010%29.pdf"
      : "file:///home/testuser/Zotero/storage/K/Marx%20%282010%29.pdf";
    const expectedPath = process.platform === "win32"
      ? "C:\\Users\\ana\\Zotero\\storage\\K\\Marx (2010).pdf"
      : "/home/testuser/Zotero/storage/K/Marx (2010).pdf";
    a.setAttribute("href", href);
    a.textContent = "Local";
    body.appendChild(a);
    const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(h.localCalls).toEqual([expectedPath]);
    expect(ev.defaultPrevented).toBe(true);
    // los demás enlaces (zotero://, https://) no se tocan
    const z = document.createElement("a");
    z.setAttribute("href", "zotero://open/library/items/K?page=1");
    body.appendChild(z);
    const ev2 = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    z.dispatchEvent(ev2);
    expect(h.localCalls).toHaveLength(1);
    expect(ev2.defaultPrevented).toBe(false);
  });
});

// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { attachmentChoices, buildItemMenu, toNativePath, zoteroOpenUri, type OpenDeps } from "../src/services/itemActions";
import { Floating } from "../src/ui/floating";
import { buildListRows, SELECTED_SECTION } from "../src/ui/listRows";
import { defaultViewState, derive } from "../src/ui/state";
import { attachment, item } from "./fixtures";
import { installObsidianDom } from "./obsidianDom";

beforeAll(() => installObsidianDom(window as unknown as Window & typeof globalThis));

describe("0.9.3: desplegable flotante común", () => {
  const make = () => {
    const trigger = document.body.createDiv({ text: "disparador" });
    const content = document.createElement("div");
    content.textContent = "contenido";
    const closed: number[] = [];
    const f = new Floating(trigger, content, { cls: "prueba", maxHeight: 200, onClose: () => closed.push(1) });
    return { trigger, content, f, closed };
  };

  it("se cuelga del <body>, empieza cerrado y se abre y cierra con toggle", () => {
    const { f } = make();
    expect(f.el.parentElement).toBe(document.body);
    expect(f.el.classList.contains("is-hidden")).toBe(true);
    f.toggle();
    expect(f.isOpen).toBe(true);
    expect(f.el.classList.contains("is-hidden")).toBe(false);
    expect(f.el.style.maxHeight).not.toBe("");
    f.toggle();
    expect(f.isOpen).toBe(false);
  });

  it("un clic fuera lo cierra; uno dentro o en el disparador, no", () => {
    const { f, content, trigger, closed } = make();
    f.open();
    content.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    trigger.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(f.isOpen).toBe(true);
    document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    expect(f.isOpen).toBe(false);
    expect(closed).toHaveLength(1);
  });

  it("el scroll no lo cierra: el de su contenido o el de otras listas se ignora y el de un ancestro del disparador lo recoloca", () => {
    const { f, content, trigger } = make();
    const panel = document.body.createDiv();
    panel.appendChild(trigger);
    f.open();
    content.dispatchEvent(new window.Event("scroll", { bubbles: false }));
    document.body.createDiv().dispatchEvent(new window.Event("scroll")); // otra lista cualquiera
    expect(f.isOpen).toBe(true);
    f.el.style.top = "999px";
    panel.dispatchEvent(new window.Event("scroll")); // el panel que contiene al disparador se desplaza
    expect(f.isOpen).toBe(true);
    expect(f.el.style.top).not.toBe("999px"); // se recolocó
  });

  it("sweep retira los desplegables cuyo disparador ya no está en el documento", () => {
    const { f, trigger } = make();
    f.open();
    trigger.remove();
    Floating.sweep();
    expect(document.body.contains(f.el)).toBe(false);
  });

  it("sweep con una raíz retira los de los disparadores que contiene", () => {
    const root = document.body.createDiv();
    const trigger = root.createDiv();
    const f = new Floating(trigger, document.createElement("div"));
    const other = make();
    Floating.sweep(root);
    expect(document.body.contains(f.el)).toBe(false);
    expect(document.body.contains(other.f.el)).toBe(true);
  });
});

describe("0.9.3: menú contextual de un ítem", () => {
  const index = LibraryIndex.fromRaw({
    entities: [
      item("UNO00001", { title: "Un adjunto" }),
      item("VARIOS01", { title: "Varios adjuntos" }),
      item("SINARCH1", { title: "Solo un enlace" }),
      attachment("PDFUNO01", "UNO00001"),
      attachment("WORD0001", "VARIOS01", { contentType: "application/msword", filename: "informe.docx", title: "Informe" }),
      attachment("PDFDOS01", "VARIOS01"),
      attachment("LINK0001", "SINARCH1", { linkMode: "linked_url", filename: "", contentType: "text/html" }),
    ],
    collections: [],
    libraryVersion: 1,
    total: 0,
    truncated: false,
  });
  const calls: string[] = [];
  const deps: OpenDeps = {
    openUrl: (u) => calls.push(`url ${u}`),
    openPath: (p) => calls.push(`open ${p}`),
    showInFolder: (p) => calls.push(`find ${p}`),
  };
  const choices = (key: string) => attachmentChoices(index, index.entry(key)!, "/datos/Zotero");

  it("los PDF van primero y luego el resto en el orden de Zotero", () => {
    expect(choices("VARIOS01").map((c) => c.key)).toEqual(["PDFDOS01", "WORD0001"]);
  });

  it("con un solo adjunto actúa directamente", () => {
    calls.length = 0;
    const m = buildItemMenu(choices("UNO00001"), "UNO00001", deps);
    expect(m.map((e) => e.title)).toEqual(["Abrir en Zotero", "Encontrar en Zotero", "Abrir local", "Encontrar local"]);
    expect(m.every((e) => !e.submenu && !e.disabled)).toBe(true);
    m[0]!.run!();
    m[1]!.run!();
    m[2]!.run!();
    m[3]!.run!();
    expect(calls[0]).toBe("url zotero://open/library/items/PDFUNO01?page=1"); // PDF: primera página
    expect(calls[1]).toBe("url zotero://select/library/items/UNO00001");
    expect(calls[2]).toMatch(/^open \/datos\/Zotero\/storage\/PDFUNO01\//);
    expect(calls[3]).toMatch(/^find \/datos\/Zotero\/storage\/PDFUNO01\//);
  });

  it("con varios adjuntos, un submenú con sus nombres", () => {
    calls.length = 0;
    const m = buildItemMenu(choices("VARIOS01"), "VARIOS01", deps);
    expect(m[0]!.submenu).toHaveLength(2);
    expect(m[0]!.submenu![1]!.title).toBe("informe.docx");
    m[0]!.submenu![1]!.run!();
    expect(calls).toEqual(["url zotero://open/library/items/WORD0001"]); // no es PDF: sin página
    expect(m[1]!.submenu).toBeUndefined(); // «Encontrar en Zotero» es del ítem, no de un adjunto
  });

  it("sin archivo local, «Abrir local» y «Encontrar local» quedan desactivados", () => {
    const m = buildItemMenu(choices("SINARCH1"), "SINARCH1", deps);
    expect(m[0]!.disabled).toBeFalsy(); // abrir en Zotero sí (el adjunto existe)
    expect(m[2]).toEqual({ title: "Abrir local", disabled: true });
    expect(m[3]).toEqual({ title: "Encontrar local", disabled: true });
  });

  it("un ítem sin adjuntos desactiva también «Abrir en Zotero»", () => {
    const m = buildItemMenu([], "X", deps);
    expect(m[0]).toEqual({ title: "Abrir en Zotero", disabled: true });
    expect(m[1]!.run).toBeTypeOf("function");
  });

  it("en Windows las rutas usan barras invertidas", () => {
    expect(toNativePath("C:/Users/a/Zotero/storage/K/x.pdf", "win32")).toBe("C:\\Users\\a\\Zotero\\storage\\K\\x.pdf");
    expect(toNativePath("/home/a/x.pdf", "linux")).toBe("/home/a/x.pdf");
    expect(zoteroOpenUri("ABC")).toBe("zotero://open/library/items/ABC");
  });

  it("un adjunto sin contenedor se abre a sí mismo", () => {
    const idx = LibraryIndex.fromRaw({ entities: [attachment("SUELTO01", null)], collections: [], libraryVersion: 1, total: 0, truncated: false });
    const entry = idx.entry("SUELTO01")!;
    expect(attachmentChoices(idx, entry, "/d").map((c) => c.key)).toEqual(["SUELTO01"]);
  });
});

describe("0.9.3: filas de la lista", () => {
  const idx = LibraryIndex.fromRaw({
    entities: [item("AAAAAAA1", { title: "Uno", date: "1900" }, { parsedDate: "1900" }), item("BBBBBBB1", { title: "Dos", date: "1901" }, { parsedDate: "1901" })],
    collections: [],
    libraryVersion: 1,
    total: 0,
    truncated: false,
  });

  it("las cabeceras llevan las claves de sus ítems y solo el último seleccionado lleva el separador", () => {
    const d = derive(idx, { ...defaultViewState(), selectedItems: ["AAAAAAA1", "BBBBBBB1"], listGroup: "itemType" });
    const rows = buildListRows(d, new Set());
    const headers = rows.filter((r) => r.type === "header");
    const keysOf = (h: (typeof headers)[number]) => (h.type === "header" ? [...h.keys].sort() : []);
    expect(headers[0]).toMatchObject({ id: SELECTED_SECTION });
    expect(keysOf(headers[0]!)).toEqual(["AAAAAAA1", "BBBBBBB1"]);
    expect(headers[1]).toMatchObject({ kind: "group" });
    expect(keysOf(headers[1]!)).toEqual(["AAAAAAA1", "BBBBBBB1"]);
    const lasts = rows.filter((r) => r.type === "item" && r.last);
    expect(lasts).toHaveLength(1);
    expect(lasts[0]).toMatchObject({ section: SELECTED_SECTION });
  });
});

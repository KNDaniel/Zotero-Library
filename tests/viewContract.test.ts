import { describe, expect, it, vi } from "vitest";

/**
 * Contrato con Obsidian. `View` tiene métodos internos que TypeScript no declara
 * (open, close, load, unload…); si la vista los sobrescribe, Obsidian deja de
 * poder abrirla. Pasó en la 0.5.0 con `open()` y dejó la pestaña en negro.
 */
vi.mock("obsidian", () => {
  class ItemView {
    app: unknown;
    contentEl = {};
    constructor(public leaf: { app: unknown }) {
      this.app = leaf.app;
    }
  }
  return { ItemView, MarkdownRenderer: { render: async () => {} }, Notice: class {}, Modal: class {} };
});

// Nombres de View/ItemView/Component que la vista NO debe redefinir por accidente.
const RESERVED_BY_OBSIDIAN = [
  "open", "close", "load", "unload", "onload", "onunload", "register", "registerEvent", "registerDomEvent", "registerInterval",
  "addChild", "removeChild", "getState", "setState", "getEphemeralState", "setEphemeralState", "onResize", "onPaneMenu", "onHeaderMenu",
  "addAction", "constructor", "app", "leaf", "containerEl", "contentEl", "headerEl", "titleEl", "scope", "navigation", "icon", "closeable",
];
// Lo único que SÍ debe redefinir (es la API pública para vistas propias).
const ALLOWED_OVERRIDES = ["constructor", "getViewType", "getDisplayText", "getIcon", "onOpen", "onClose"];

describe("la vista respeta el contrato de Obsidian", () => {
  it("solo redefine los métodos permitidos y ninguno interno", async () => {
    const { ZoteroLibraryView } = await import("../src/ui/ZoteroLibraryView");
    const own = Object.getOwnPropertyNames(ZoteroLibraryView.prototype);
    const collisions = own.filter((n) => RESERVED_BY_OBSIDIAN.includes(n) && !ALLOWED_OVERRIDES.includes(n));
    expect(collisions).toEqual([]);
    for (const n of ALLOWED_OVERRIDES) expect(own).toContain(n);
  });

  it("las propiedades de instancia tampoco pisan nombres de Obsidian", async () => {
    const { ZoteroLibraryView } = await import("../src/ui/ZoteroLibraryView");
    const host = { settings: { viewState: {} }, version: "t" } as never;
    const view = new ZoteroLibraryView({ app: {} } as never, host);
    const props = Object.keys(view).filter((k) => !["app", "leaf", "contentEl"].includes(k));
    expect(props.filter((k) => RESERVED_BY_OBSIDIAN.includes(k))).toEqual([]);
  });

  it("el plugin tampoco define métodos que Obsidian usa para el ciclo de vida", async () => {
    // main.ts importa muchas cosas de obsidian; basta revisar los nombres declarados en el fuente.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const plugin = /export default class ZoteroLibraryPlugin extends Plugin \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
    const methods = [...plugin.matchAll(/^  (?:async |private |get )*([A-Za-z]\w*)\(/gm)].map((m) => m[1]);
    const lifecycle = ["load", "unload", "register", "registerEvent", "registerDomEvent", "registerInterval", "addChild", "removeChild", "addCommand", "addSettingTab", "loadData", "saveData", "registerView"];
    expect(methods.filter((m) => lifecycle.includes(m))).toEqual([]);
    expect(methods).toContain("onload"); // la única que debe definir
  });
});

// API de Zotero y Obsidian simulados, compartidos por las pruebas de humo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import moment from "moment";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const mainUrl = pathToFileURL(path.join(root, "main.js")).href;
export const golden = JSON.parse(fs.readFileSync(`${root}/tests/fixtures/golden.json`, "utf8"));
export const template = fs.readFileSync(`${root}/tests/fixtures/template-import-anotaciones.md`, "utf8");
export const note = fs.readFileSync(`${root}/tests/fixtures/golden-note.md`, "utf8").replace(/\r\n/g, "\n");
export const ITEM = "ITEM0001";

const person = (n) => { const [f, ...r] = n.split(" "); return { f, l: r.join(" ") }; };
const author = person(golden.authors[0]);
const translator = person(golden.translators[0]);
const base = { tags: [], relations: {}, dateAdded: "2024-01-01T00:00:00Z", dateModified: "2024-01-01T00:00:00Z", version: 1 };

export const entities = [
  { key: ITEM, version: 1, meta: { parsedDate: "2010-06" }, data: { ...base, key: ITEM, itemType: "bookSection", title: golden.fullTitle, creators: [{ creatorType: "author", firstName: author.f, lastName: author.l }, { creatorType: "translator", firstName: translator.f, lastName: translator.l }], date: "2010-Jun", publisher: golden.publisher, ISBN: golden.isbn, collections: ["COLTEST1"], relations: { "dc:relation": [`http://zotero.org/users/1/items/${golden.related.key}`] } } },
  { key: golden.related.key, version: 1, data: { ...base, key: golden.related.key, itemType: "bookSection", title: golden.related.title, creators: [{ creatorType: "author", firstName: golden.related.first, lastName: golden.related.last }], collections: [] } },
  { key: golden.attachmentKey, version: 1, data: { ...base, key: golden.attachmentKey, itemType: "attachment", parentItem: ITEM, title: golden.zoteroLabel, linkMode: "imported_file", contentType: "application/pdf", filename: golden.filename } },
];
golden.annotations.forEach((a, i) => {
  let pos = { pageIndex: 0, rects: [[1, 2, 3, 4]] };
  const m = /-(\d+)-x(\d+)-y(\d+)\.png$/.exec(a.imageRelativePath);
  if (m) pos = { pageIndex: +m[1] - 1, rects: [[+m[2], +m[3], +m[2] + 100, +m[3] + 100]] };
  entities.push({ key: a.id, version: 1, data: { ...base, key: a.id, itemType: "annotation", parentItem: golden.attachmentKey, annotationType: a.type, annotationText: a.text, annotationComment: a.comment, annotationColor: a.color, annotationPageLabel: a.pageLabel, annotationSortIndex: `${String(i).padStart(5, "0")}|000000|00000`, annotationPosition: JSON.stringify(pos), tags: a.tags.map((t) => ({ tag: t, type: 0 })), dateAdded: new Date(Date.UTC(2024, 1, 1, 0, 0, i)).toISOString() } });
});
const collections = [{ key: "COLTEST1", version: 1, data: { key: "COLTEST1", version: 1, name: "Synthetic", parentCollection: false, relations: {} } }];

export const requests = [];
export const collectionsList = collections;
export const notices = [];

class MockTFolder { constructor(path = "") { this.path = path; this.children = []; } }

export function makeObsidian(extra = {}) {
  class Stub { constructor() {} }
  return {
    Plugin: class { constructor(app, manifest) { this.app = app; this.manifest = manifest; this.commands = {}; this.views = {}; this._data = {}; } addCommand(c) { this.commands[c.id] = c; } addSettingTab() {} addRibbonIcon() {} registerView(t, f) { this.views[t] = f; } registerInterval(id) { return id; } registerDomEvent() {} async loadData() { return this._data; } async saveData(d) { this._data = d; } },
    PluginSettingTab: Stub, Setting: Stub, Modal: Stub, FuzzySuggestModal: Stub, TFolder: MockTFolder, AbstractInputSuggest: Stub, ItemView: class {
      constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.containerEl = document.createElement("div"); this.contentEl = document.createElement("div"); this.containerEl.appendChild(this.contentEl); }
      // Protocolo real: Obsidian llama a view.open(parentEl); la base adjunta el contenedor y llama a onOpen().
      async open(parentEl) { parentEl.appendChild(this.containerEl); await this.onOpen(); }
      async close() { await this.onClose(); this.containerEl.remove(); }
      registerDomEvent(el, t, f) { el.addEventListener(t, f); }
    }, MarkdownRenderer: { render: async () => {} }, normalizePath: (p) => p,
    Platform: { isWin: true, isMacOS: false, isLinux: false },
    // Menú contextual simulado: guarda sus entradas para que las pruebas de humo las inspeccionen
    Menu: class {
      constructor() { this.items = []; this.shown = false; (globalThis.__menus ??= []).push(this); }
      addItem(cb) { const it = { title: "", disabled: false, setTitle(t) { this.title = t; return this; }, setDisabled(d) { this.disabled = d; return this; }, onClick(f) { this.click = f; return this; } }; cb(it); this.items.push(it); return this; }
      addSeparator() { return this; }
      showAtMouseEvent() { this.shown = true; }
    },
    TFile: class { constructor(p) { this.path = p; } },
    Notice: class { constructor(m) { notices.push(m); } setMessage() {} hide() {} },
    moment,
    requestUrl: async ({ url, headers }) => {
      requests.push({ url, headers });
      const u = new URL(url);
      if (u.searchParams.get("itemType") === "annotation") return { status: 200, headers: { "total-results": "0" }, text: "[]", json: [] };
      const list = u.pathname.endsWith("/collections") ? collections : entities;
      return { status: 200, headers: { "total-results": String(list.length), "last-modified-version": "7", "zotero-api-version": "3" }, text: "", json: list };
    },
    ...extra,
  };
}

export function appWith(files, active = null) {
  const cache = new Map();
  const root = new MockTFolder();
  const entries = new Map([["", root]]);
  for (const { file } of files) {
    const parts = file.path.split("/");
    let parent = root;
    let path = "";
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part;
      let folder = entries.get(path);
      if (!folder) { folder = new MockTFolder(path); entries.set(path, folder); parent.children.push(folder); }
      parent = folder;
    }
    entries.set(file.path, file);
    parent.children.push(file);
  }
  return { vault: { adapter: { exists: async (p) => cache.has(p), readBinary: async (p) => cache.get(p), writeBinary: async (p, b) => cache.set(p, b), remove: async (p) => cache.delete(p) }, getRoot: () => root, getFiles: () => files.map((f) => f.file), cachedRead: async (f) => files.find((x) => x.file === f).content, getAbstractFileByPath: (p) => entries.get(p) ?? null, getAllLoadedFiles: () => [] }, workspace: { getActiveFile: () => active, getLastOpenFiles: () => [], getLeavesOfType: () => [], getLeaf: () => ({}), revealLeaf() {}, openLinkText() {} } };
}

// La VISTA COMPLETA con una biblioteca del tamaño de la tuya (564 ítems, 10 500 anotaciones).
import Module from "node:module";
import { $, $$, click, installDom, sleep } from "./dom-polyfill.mjs";
import { appWith, makeObsidian, mainUrl } from "./fake-zotero.mjs";

installDom();
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const words = "capital mercancía valor trabajo fuerza dinero ley economía sociedad historia espíritu ideología clase producción".split(" ");
const pick = (a) => a[Math.floor(rnd() * a.length)];
const sentence = (n) => Array.from({ length: n }, () => pick(words)).join(" ");
const tagPool = Array.from({ length: 2782 }, (_, i) => `etiqueta ${i} ${pick(words)}`);
const base = { relations: {}, dateAdded: "2024-01-01T00:00:00Z", dateModified: "2024-01-01T00:00:00Z", version: 1 };
const entities = [];
const cols = Array.from({ length: 55 }, (_, i) => ({ key: `COL${String(i).padStart(5, "0")}`, version: 1, data: { key: `COL${String(i).padStart(5, "0")}`, version: 1, name: `Colección ${i}`, parentCollection: i > 8 ? `COL${String(i % 9).padStart(5, "0")}` : false, relations: {} } }));
for (let i = 0; i < 564; i++) { const key = `IT${String(i).padStart(6, "0")}`; entities.push({ key, version: 1, meta: { parsedDate: String(1800 + (i % 220)) }, data: { ...base, key, itemType: "book", title: `Título ${i} ${sentence(5)}`, creators: [{ creatorType: "author", firstName: sentence(1), lastName: `Apellido${i % 200}` }], date: String(1800 + (i % 220)), abstractNote: sentence(60), publisher: sentence(2), collections: [cols[i % 55].key], tags: [{ tag: pick(tagPool), type: 0 }] } }); }
for (let a = 0; a < 617; a++) { const key = `AT${String(a).padStart(6, "0")}`; entities.push({ key, version: 1, data: { ...base, key, itemType: "attachment", ...(a < 564 ? { parentItem: `IT${String(a).padStart(6, "0")}` } : {}), title: "PDF", linkMode: "imported_file", contentType: "application/pdf", filename: `${key}.pdf`, tags: [] } }); }
for (let k = 0; k < 10500; k++) { const key = `AN${String(k).padStart(6, "0")}`; entities.push({ key, version: 1, data: { ...base, key, itemType: "annotation", parentItem: `AT${String(k % 560).padStart(6, "0")}`, annotationType: pick(["highlight", "underline", "note", "image"]), annotationText: sentence(30 + Math.floor(rnd() * 40)), annotationComment: rnd() > 0.5 ? sentence(15) : "", annotationColor: pick(["#ffd400", "#ff6666", "#5fb236", "#2ea8e5"]), annotationPageLabel: String(k % 300), annotationSortIndex: `${String(Math.floor(k / 560)).padStart(5, "0")}|${String(Math.floor(rnd() * 99999)).padStart(6, "0")}|00100`, annotationPosition: JSON.stringify({ pageIndex: k % 300, rects: [[10, 20, 30, 40]] }), tags: Array.from({ length: Math.floor(rnd() * 4) }, () => ({ tag: pick(tagPool), type: 0 })) } }); }

const requestUrl = async ({ url }) => {
  const u = new URL(url); const path = u.pathname.replace("/api/users/0", "");
  const h = { "last-modified-version": "9757", "zotero-api-version": "3" };
  if (path === "/collections") return { status: 200, headers: { ...h, "total-results": String(cols.length) }, text: "", json: cols };
  const limit = Number(u.searchParams.get("limit") ?? Infinity);
  return { status: 200, headers: { ...h, "total-results": String(entities.length) }, text: "", json: entities.slice(0, limit) };
};
const rendered = { n: 0 };
const obsidian = makeObsidian({ requestUrl, MarkdownRenderer: { render: async (_a, md, el) => { rendered.n++; el.textContent = md; } } });
const origLoad = Module._load; Module._load = function (r, ...rest) { return r === "obsidian" ? obsidian : origLoad.call(this, r, ...rest); };
const Plugin = (await import(mainUrl)).default?.default;
const app = appWith([]);
// This benchmark focuses on derivation/rendering, but the normal sync also
// writes the synthetic library cache. Keep that side effect inside the fake
// vault instead of logging an unrelated missing-adapter error.
app.vault.adapter = { writeBinary: async () => {} };
const p = new Plugin(app, { version: "test", dir: ".obsidian/plugins/zotero-library" });
await p.onload();

const t = (label, t0) => console.log(`${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${label}`);
let t0 = performance.now();
await p.loadLibrary(false); t("loadLibrary (11 705 entidades, API simulada)", t0);
t0 = performance.now();
const view = p.views["zotero-library-view"]({ app });
await view.open(document.body); t("onOpen (debe ser inmediato)", t0);
t0 = performance.now(); await view.ready; t("ready: índice + montar los tres paneles", t0);
console.log("  ítems en la lista:", $$(".zl-items .zl-vrow").length, "· filas de etiquetas:", $$(".zl-tags .zl-vrow").length);

t0 = performance.now(); click($$(".zl-items .zl-actions .zl-seg-btn").find((b) => b.textContent === "Todos")); await sleep(300); t("seleccionar los 564 ítems (derive + paneles + 30 tarjetas)", t0);
console.log("  ", $(".zl-items .zl-count").textContent, "·", $(".zl-tags .zl-count").textContent, "· tarjetas:", $$(".zl-card").length);
t0 = performance.now(); click($$(".zl-results .zl-panel-head .zl-seg button")[1]); await sleep(300); t("modo anotación con 10 500 anotaciones", t0);
console.log("   tarjetas:", $$(".zl-card").length, "·", $(".zl-results .zl-count").textContent);
t0 = performance.now(); for (let i = 0; i < 10; i++) { click($(".zl-more .zl-btn")); await sleep(30); } t("«Mostrar más» ×10", t0);
console.log("   tarjetas:", $$(".zl-card").length);
t0 = performance.now(); const sel = $(".zl-results .zl-toolbar select:nth-of-type(4)"); sel.value = "tag"; sel.dispatchEvent(new window.Event("change", { bubbles: true })); await sleep(400); t("agrupar por etiqueta (cada anotación en cada grupo)", t0);
console.log("   tarjetas:", $$(".zl-card").length, "· grupos:", $$(".zl-group").length);
t0 = performance.now(); click($(".zl-tags .zl-vrow")); await sleep(300); t("elegir una etiqueta", t0);
console.log("   tarjetas:", $$(".zl-card").length, "·", $(".zl-results .zl-count").textContent);
console.log("RESULTADO: la vista procesa una biblioteca sintética de escala y completa los recorridos medidos");
process.exit(0);

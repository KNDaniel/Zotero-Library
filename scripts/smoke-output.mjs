// Salidas con el paquete real: copiar, insertar, nota nueva, bibliografía e imágenes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import { $, $$, click, installDom, sleep } from "./dom-polyfill.mjs";
import { ITEM, entities, golden, makeObsidian, note, mainUrl, template } from "./fake-zotero.mjs";

installDom();
const clip = [];
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t) => void clip.push(t) } }, configurable: true, writable: true });

class TFile { constructor(p) { this.path = p; this.name = p.split("/").pop(); this.extension = this.name.split(".").pop(); } }
// Vault simulado en memoria
const files = new Map(); const folders = new Set(); const opened = [];
const putFile = (p, content) => { const f = new TFile(p); files.set(p, { file: f, content }); return f; };
putFile("Zotero Library/Plantillas/import.md", template);
const vault = {
  adapter: { exists: async (p) => files.has(p) || folders.has(p), readBinary: async (p) => files.get(p).content, writeBinary: async (p, b) => void putFile(p, b), remove: async (p) => void files.delete(p) },
  getFiles: () => [...files.values()].map((f) => f.file),
  cachedRead: async (f) => files.get(f.path).content,
  getAbstractFileByPath: (p) => files.get(p)?.file ?? null,
  createFolder: async (p) => { if (folders.has(p)) throw new Error("Folder already exists"); folders.add(p); },
  create: async (p, text) => putFile(p, text),
  createBinary: async (p, data) => putFile(p, data),
  append: async (f, text) => { files.get(f.path).content += text; },
  getAllLoadedFiles: () => [],
};
const ws = { active: null, editorLeaf: null, inserted: [] };
const app = { vault, workspace: { getActiveFile: () => ws.active, getLastOpenFiles: () => [], getLeavesOfType: (t) => (t === "markdown" && ws.editorLeaf ? [ws.editorLeaf] : []), getLeaf: () => ({ openFile: async (f) => void opened.push(f.path) }), revealLeaf() {}, openLinkText() {} } };

// Zotero simulado + bibliografía
const bibCalls = [];
const base = makeObsidian({ TFile, MarkdownView: class {} });
const original = base.requestUrl;
base.requestUrl = async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("format") === "bib") {
    bibCalls.push(req.url);
    if (u.searchParams.get("style") === "zzz") return { status: 400, headers: {}, text: "", json: null };
    const keys = u.pathname.endsWith("/items") ? u.searchParams.get("itemKey").split(",") : [u.pathname.split("/").pop()];
    const title = (k) => entities.find((e) => e.key === k)?.data.title ?? k;
    const body = keys.map((k) => `<div class="csl-entry">Example Author (2020). <i>${title(k)}</i>.</div>`).join("");
    return { status: 200, headers: {}, text: `<div class="csl-bib-body">${body}</div>`, json: null };
  }
  return original(req);
};
const origLoad = Module._load;
const nativeFs = origLoad.call(Module, "fs");
const simulatedFs = Object.create(nativeFs);
Object.defineProperty(simulatedFs, "promises", {
  value: new Proxy(nativeFs.promises, {
    get(target, key, receiver) {
      if (key !== "access") return Reflect.get(target, key, receiver);
      return async (file, ...args) => {
        const normalized = String(file).replace(/\\/g, "/");
        if (normalized.startsWith("C:/ZoteroSynthetic/cache/library/")) {
          throw Object.assign(new Error("ENOENT: simulated missing Zotero image"), { code: "ENOENT" });
        }
        return target.access(file, ...args);
      };
    },
  }),
  enumerable: true,
});
Module._load = function (r, ...rest) {
  if (r === "obsidian") return base;
  if (r === "fs") return simulatedFs;
  return origLoad.call(this, r, ...rest);
};
const Plugin = (await import(mainUrl)).default?.default;

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const status = () => $(".zl-output-status")?.textContent ?? "";
const btn = (label) => $$(".zl-output .zl-btn").find((b) => b.textContent === label);
const set = (el, value, ev = "change") => { el.value = value; el.dispatchEvent(new window.Event(ev, { bubbles: true })); };

async function session(dataDir) {
  document.body.innerHTML = "";
  const p = new Plugin(app, { version: "test", dir: ".obsidian/plugins/zotero-library" });
  await p.onload();
  p.settings.zoteroDataDir = dataDir;
  const view = p.views["zotero-library-view"]({ app });
  await view.open(document.body);
  await view.ready;
  set($(".zl-simple input"), `@clave: ${ITEM}`, "input");
  await sleep(150);
  click($(".zl-items .zl-vrow"));
  await sleep(250);
  return { p, view };
}

// ---- 1) Tu ruta de datos solo se usa como texto; el FS simulado bloquea lecturas de la caché real ----
let s = await session(golden.dataDir);
check("hay un ítem seleccionado y los botones están activos", $(".zl-items .zl-count").textContent === "1 seleccionado de 1" && !btn("Copiar").disabled);
set($(".zl-output-template"), "import.md");
await sleep(100);
click(btn("Copiar")); await sleep(500);
check("«Copiar» con la plantilla copia la nota byte a byte", clip.at(-1) === note, `${clip.at(-1)?.length} caracteres`);
check("el resumen cuenta ítems y anotaciones y avisa de las imágenes que no están en la caché", /^✓ Copiado: 1 ítem\(s\) · 71 anotación\(es\)/.test(status()) && status().includes("2 imagen(es) no encontrada(s) en la caché de Zotero"), status());

// ---- 2) Nueva nota ----
click(btn("Nueva nota")); await sleep(500);
const created = [...files.keys()].filter((k) => k.startsWith("Zotero Library/Salidas/"));
check("«Nueva nota» crea el archivo en la carpeta configurada", created.length === 1 && /^Zotero Library\/Salidas\/Zotero Library \d{4}-\d\d-\d\d \d{4}\.md$/.test(created[0]), created[0]);
check("la nota nueva contiene la nota y se abre", files.get(created[0]).content === note && opened.length === 1 && folders.has("Zotero Library/Salidas"));
click(btn("Nueva nota")); await sleep(500);
const created2 = [...files.keys()].filter((k) => k.startsWith("Zotero Library/Salidas/"));
check("una segunda nota con el mismo nombre no pisa la primera y añade la clave de Zotero", created2.length === 2 && created2.some((k) => / [A-Z0-9]{8}\.md$/.test(k)), created2.map((k) => k.split("/").pop()).join(" | "));

// ---- 3) Insertar en la nota activa ----
click(btn("Insertar en la nota")); await sleep(300);
check("sin ninguna nota abierta avisa con claridad", status().startsWith("⚠️ No hay ninguna nota abierta"), status());
ws.active = putFile("Diario/Hoy.md", "Contenido previo");
click(btn("Insertar en la nota")); await sleep(500);
check("sin editor abierto, añade al final de la nota", files.get("Diario/Hoy.md").content === `Contenido previo\n${note}` && status().includes("Insertado en «Diario/Hoy.md»"), status().slice(0, 60));
ws.editorLeaf = { view: { file: ws.active, editor: { replaceSelection: (t) => ws.inserted.push(t) } } };
click(btn("Insertar en la nota")); await sleep(500);
check("con la nota abierta en un editor, inserta en el cursor", ws.inserted.length === 1 && ws.inserted[0] === note);

// ---- 4) Bibliografía ----
set($(".zl-output select"), "bibliography"); await sleep(100);
check("al elegir bibliografía aparece el campo de estilo", !$(".zl-output-style").classList.contains("is-hidden"));
click(btn("Copiar")); await sleep(500);
check("bibliografía con el estilo de los ajustes (apa): una entrada por párrafo", clip.at(-1).startsWith("Example Author (2020). *Synthetic Reference") && /style=apa/.test(bibCalls.at(-1)) && /itemKey=ITEM0001/.test(bibCalls.at(-1)), clip.at(-1).slice(0, 70));
set($(".zl-output-style input"), "iso690-author-date-es", "input"); await sleep(100);
click(btn("Copiar")); await sleep(500);
check("estilo elegido en la barra", /style=iso690-author-date-es/.test(bibCalls.at(-1)));
set($(".zl-output-style input"), "zzz", "input"); await sleep(100);
click(btn("Copiar")); await sleep(500);
check("un estilo que Zotero no tiene da un error claro", status().startsWith("⚠️ El estilo «zzz» no está disponible en tu Zotero"), status());

// ---- 5) Imágenes: de la caché de Zotero al vault ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zl-zotero-"));
fs.mkdirSync(path.join(tmp, "cache/library"), { recursive: true });
const png = (n) => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, n]);
fs.writeFileSync(path.join(tmp, "cache/library/ANN00001.png"), png(1));
fs.writeFileSync(path.join(tmp, "cache/library/ANN00002.png"), png(2));
files.delete("Recursos/Img. Titulos/ATTACH01-8-x98-y662.png");
s = await session(tmp.replace(/\\/g, "/"));
set($(".zl-output select"), "annotations"); await sleep(100);
click(btn("Copiar")); await sleep(600);
const img1 = files.get("Recursos/Img. Titulos/ATTACH01-8-x98-y662.png"), img2 = files.get("Recursos/Img. Titulos/ATTACH01-49-x139-y630.png");
check("«Solo anotaciones»: copia las imágenes al vault con la carpeta y el nombre", !!img1 && !!img2 && Buffer.from(img1.content).equals(png(1)) && Buffer.from(img2.content).equals(png(2)));
check("el resumen lo cuenta y el texto referencia las imágenes", status().includes("2 imagen(es) copiada(s) al vault") && clip.at(-1).includes("![[Recursos/Img. Titulos/ATTACH01-8-x98-y662.png|300]]"), status().slice(0, 110));
check("las imágenes están en una carpeta del vault", folders.has("Recursos") && folders.has("Recursos/Img. Titulos"));
click(btn("Copiar")); await sleep(600);
check("una segunda salida reutiliza las imágenes que ya están (no las repite)", !status().includes("copiada(s)") && status().startsWith("✓"), status().slice(0, 90));

// ---- 6) Botones de cada tarjeta ----
click($$(".zl-results .zl-panel-head .zl-seg button")[1]); await sleep(300);
check("modo anotación: hay tarjetas con botones", $$(".zl-card .zl-card-actions").length >= 30, `${$$(".zl-card").length} tarjetas`);
const card = $$(".zl-card")[1];
const expectedId = card.querySelector(".zl-card-body").textContent;
click($$(".zl-btn", card).find((b) => b.textContent === "Copiar")); await sleep(500);
check("«Copiar» de una tarjeta copia solo esa anotación", !clip.at(-1).includes("\n\n") || clip.at(-1).split("\n\n").length < 5, `${clip.at(-1).length} caracteres`);
check("y lo resume como una sola anotación", status().includes("1 ítem(s) · 1 anotación(es)"), status().slice(0, 80));

console.log(failures ? `\n${failures} comprobación(es) fallida(s)` : "\nRESULTADO: las salidas funcionan de principio a fin");
process.exit(failures ? 1 : 0);

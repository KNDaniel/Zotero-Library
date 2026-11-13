// Copia en disco y sincronización incremental, con el paquete real y un Zotero simulado programable.
import Module from "node:module";
import { EventEmitter } from "node:events";
import { $, $$, click, installDom, sleep } from "./dom-polyfill.mjs";
import { ITEM, appWith, collectionsList, entities, golden, makeObsidian, mainUrl, template } from "./fake-zotero.mjs";

installDom();
const server = { version: 7, list: structuredClone(entities), mods: new Map(entities.map((e) => [e.key, 7])), deleted: [], supportsSince: true, supportsDeleted: true, supportsKeys: false, down: false, delay: 0 };
const calls = [];
const json = (data, headers, status = 200) => ({ status, headers, text: "", json: data });
const requestUrl = async ({ url }) => {
  if (server.down) throw new Error("net::ERR_CONNECTION_REFUSED");
  if (server.delay) await sleep(server.delay);
  calls.push(url);
  const u = new URL(url);
  const path = u.pathname.replace("/api/users/0", "");
  const h = { "last-modified-version": String(server.version), "zotero-api-version": "3" };
  if (u.searchParams.get("format") === "keys" && server.supportsKeys) {
    const keys = path === "/collections" ? collectionsList.map((c) => c.key) : server.list.map((e) => e.key);
    return { status: 200, headers: h, text: keys.join("\n"), json: null };
  }
  if (path === "/deleted") return server.supportsDeleted ? json({ items: server.deleted, collections: [] }, h) : json(null, h, 404);
  if (path === "/collections") return json(collectionsList, { ...h, "total-results": String(collectionsList.length) });
  if (u.searchParams.get("itemType") === "annotation") return json([], { ...h, "total-results": "0" });
  let list = server.list;
  if (u.searchParams.has("since") && server.supportsSince) list = list.filter((e) => server.mods.get(e.key) > Number(u.searchParams.get("since")));
  const limit = Number(u.searchParams.get("limit") ?? Infinity);
  return json(list.slice(0, limit), { ...h, "total-results": String(list.length) });
};
const fullDownloads = () => calls.filter((c) => /\/items\?$|\/items$/.test(c)).length; // /items sin parámetros

const rendered = [];
const obsidian = makeObsidian({ requestUrl, MarkdownRenderer: { render: async (_a, md, el) => { rendered.push(md); el.textContent = md; } } });
// El transporte alternativo del plugin nunca debe salir del simulador ni consultar Zotero en localhost.
const simulatedHttp = {
  get: () => {
    const req = new EventEmitter();
    req.destroy = (error) => { if (error) queueMicrotask(() => req.emit("error", error)); return req; };
    queueMicrotask(() => req.emit("error", new Error("simulated offline")));
    return req;
  },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "obsidian") return obsidian;
  if (request === "http") return simulatedHttp;
  return origLoad.call(this, request, ...rest);
};
const Plugin = (await import(mainUrl)).default?.default;

// Disco simulado (compartido entre «sesiones» de Obsidian)
const disk = new Map();
const adapter = { exists: async (p) => disk.has(p), readBinary: async (p) => disk.get(p), writeBinary: async (p, b) => disk.set(p, b), remove: async (p) => disk.delete(p) };
const app = appWith([{ file: new obsidian.TFile("Zotero Library/Plantillas/import.md"), content: template }]);
app.vault.adapter = adapter;

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
async function waitUntil(test, timeoutMs = 1000) {
  const start = Date.now();
  while (!test() && Date.now() - start < timeoutMs) await sleep(10);
  return test();
}

async function session(label, tweak = (p) => {}) {
  document.body.innerHTML = "";
  calls.length = 0;
  const p = new Plugin(app, { version: "test", dir: ".obsidian/plugins/zotero-library" });
  await p.onload();
  p.settings.zoteroDataDir = golden.dataDir;
  tweak(p);
  const view = p.views["zotero-library-view"]({ app });
  await view.open(document.body);
  await view.ready;
  return {
    p, view,
    status: () => $(".zl-status")?.textContent ?? "",
    tip: () => $(".zl-status")?.getAttribute("title") ?? "",
    origin: () => $(".zl-origin")?.textContent ?? "",
    stats: () => { const x = p.index.stats(); return `${x.items} ítems · ${x.annotations} anotaciones`; },
  };
}

// 1) Primera apertura: no hay copia, se carga todo y se guarda
let s = await session("primera");
await sleep(400);
check("1ª apertura: carga completa desde Zotero", /^Zotero \d+\.\d s$/.test(s.origin()) && s.status() === "Sincronizado" && fullDownloads() >= 1, `${s.origin()} | ${s.status()}`);
check("1ª apertura: se guarda la copia comprimida", disk.size === 1 && [...disk.keys()][0].endsWith("library-cache.json.gz"), `${[...disk.values()][0]?.byteLength} bytes`);
check("1ª apertura: recuento", s.stats() === "2 ítems · 71 anotaciones", s.stats());

// 2) Segunda apertura (otro Obsidian): desde la copia, sin descargar y al día
s = await session("segunda");
const opened = s.origin();
check("2ª apertura: desde la copia en disco, con el tiempo a la vista", /^Local \d+ ms$/.test(opened) && s.stats() === "2 ítems · 71 anotaciones", opened);
check("2ª apertura: los paneles se montan al instante", $$(".zl-items .zl-vrow").length === 2);
await sleep(200);
check("2ª apertura: sincroniza y está al día (sin perder el tiempo de apertura)", s.status() === "Sincronizado" && s.origin().startsWith("Local"), `${s.origin()} | ${s.status()}`);
check("2ª apertura: no descarga la biblioteca (solo pregunta la versión)", fullDownloads() === 0 && calls.length === 1 && calls[0].includes("limit=1"), `${calls.length} petición(es)`);

// 3) Cambios en Zotero: edición, alta y borrado -> sincronización incremental
const editKey = golden.annotations[0].id, delKey = golden.annotations[1].id;
server.list.find((e) => e.key === editKey).data.annotationText = "EDITADO EN ZOTERO"; server.version = 8; server.mods.set(editKey, 8);
const newAnn = structuredClone(server.list.find((e) => e.key === editKey)); newAnn.key = newAnn.data.key = "NEWANN01"; newAnn.data.annotationSortIndex = "99999|000000|00000"; server.list.push(newAnn); server.version = 9; server.mods.set("NEWANN01", 9);
server.list = server.list.filter((e) => e.key !== delKey); server.deleted.push(delKey); server.version = 10;
calls.length = 0;
click($(".zl-topbar .zl-btn")); await sleep(400);
const idx = s.p.index;
check("3) sincronización incremental aplicada", s.status() === "Sincronizado" && s.tip().includes("Cambios aplicados"), `${s.status()} | ${s.tip()}`);
check("3) lo editado, lo nuevo y lo borrado se reflejan", idx.annotations.get(editKey).text === "EDITADO EN ZOTERO" && idx.annotations.has("NEWANN01") && !idx.annotations.has(delKey), `${idx.stats().annotations} anotaciones`);
check("3) pidió solo los cambios (since) y los borrados", calls.some((c) => c.includes("since=7")) && calls.some((c) => c.includes("/deleted")) && fullDownloads() === 0);
check("3) el índice refleja el recuento nuevo", s.stats() === "2 ítems · 71 anotaciones");
await sleep(300);
s = await session("tercera");
check("3) la copia guardada incluye los cambios", s.p.index.annotations.get(editKey)?.text === "EDITADO EN ZOTERO" && s.origin().startsWith("Local"));
await sleep(200);
check("3) y queda sincronizado", s.status() === "Sincronizado", s.status());

// 4) Sin /deleted la API no permite detectar borrados: se recarga todo
server.supportsDeleted = false;
server.list.find((e) => e.key === editKey).data.annotationText = "SEGUNDA EDICIÓN"; server.version = 11; server.mods.set(editKey, 11);
calls.length = 0;
click($(".zl-topbar .zl-btn")); await sleep(500);
check("4) sin /deleted: recarga completa", s.tip().includes("Biblioteca recargada") && s.p.index.annotations.get(editKey).text === "SEGUNDA EDICIÓN" && fullDownloads() >= 1, s.status());
server.supportsDeleted = true;

// 4b) Sin /deleted pero con lista de claves: sincronización incremental y los borrados se detectan
server.supportsDeleted = false; server.supportsKeys = true;
const goneKey = golden.annotations[2].id;
server.list = server.list.filter((e) => e.key !== goneKey); server.version = 12;
server.list.find((e) => e.key === editKey).data.annotationText = "TERCERA EDICIÓN"; server.mods.set(editKey, 12);
calls.length = 0;
click($(".zl-topbar .zl-btn")); await sleep(500);
check("4b) sin /deleted pero con claves: sincronización incremental", s.tip().includes("Cambios aplicados") && fullDownloads() === 0, s.tip());
check("4b) se detecta el borrado y se aplica la edición", !s.p.index.annotations.has(goneKey) && s.p.index.annotations.get(editKey).text === "TERCERA EDICIÓN");
server.supportsKeys = false; server.supportsDeleted = true;

// 5) Zotero cerrado: se abre con la copia y se avisa
await sleep(300);
server.down = true;
s = await session("offline");
check("5) con Zotero cerrado se abre desde la copia", $$(".zl-items .zl-vrow").length === 2 && s.stats() === "2 ítems · 70 anotaciones", s.stats());
const offlineSettled = await waitUntil(() => /^Última sincronización /.test(s.status()));
check("5) con Zotero cerrado muestra la última sincronización con fecha", offlineSettled && /^Última sincronización \d{4}, [a-z]{3} \d{2} \d{2}:\d{2}$/.test(s.status()), s.status());
server.down = false;

// 6) Copia desactivada: no se lee la copia
s = await session("sin copia", (p) => { p.settings.useDiskCache = false; });
check("6) con la copia desactivada se carga desde Zotero", s.origin().startsWith("Zotero "), s.origin());

// 7) Copia dañada: se ignora y se carga desde Zotero
disk.set([...disk.keys()][0], new Uint8Array([1, 2, 3]).buffer);
s = await session("dañada");
check("7) una copia dañada se ignora sin romper nada", s.origin().startsWith("Zotero ") && s.stats() === "2 ítems · 70 anotaciones", s.origin());

// 8) onOpen vuelve enseguida aunque la carga sea lenta (si no, Obsidian deja la pestaña en negro)
disk.clear();
server.delay = 1300;
document.body.innerHTML = "";
{
  const p = new Plugin(app, { version: "test", dir: ".obsidian/plugins/zotero-library" });
  await p.onload();
  p.settings.zoteroDataDir = golden.dataDir;
  const view = p.views["zotero-library-view"]({ app });
  const t0 = Date.now();
  await view.open(document.body);
  const openMs = Date.now() - t0;
  check("8) onOpen vuelve enseguida con una carga lenta", openMs < 100, `${openMs} ms`);
  check("8) la vista ya tiene barra superior y mensaje de carga", !!$(".zl-topbar") && !!$(".zl-topbar .zl-btn") && /Abriendo la biblioteca|Cargando la biblioteca/.test($(".zl-layout > .zl-empty")?.textContent ?? ""), $(".zl-layout > .zl-empty")?.textContent.split("\n")[0]);
  await sleep(1100);
  check("8) el mensaje muestra los segundos transcurridos", /\d+ s/.test($(".zl-layout > .zl-empty")?.textContent ?? ""), ($(".zl-layout > .zl-empty")?.textContent ?? "").split("\n")[0]);
  await view.ready;
  check("8) al terminar la carga se montan los paneles", $$(".zl-items .zl-vrow").length === 2 && !$(".zl-layout > .zl-empty"));
}
server.delay = 0;

// 9) Dos cargas a la vez comparten la misma descarga (Zotero atiende de una en una)
disk.clear();
calls.length = 0;
{
  const p = new Plugin(app, { version: "test", dir: ".obsidian/plugins/zotero-library" });
  await p.onload();
  const [a, b] = await Promise.all([p.loadLibrary(false), p.loadLibrary(false)]);
  check("9) cargas simultáneas comparten una sola descarga", fullDownloads() === 1 && a === b, `${fullDownloads()} descarga(s)`);
}

// 10) Recuperación de pestañas rotas con activateView
{
  document.body.innerHTML = "";
  const leaves = [], revealed = [], created = [];
  const mkApp = () => {
    const a = appWith([{ file: new obsidian.TFile("Zotero Library/Plantillas/import.md"), content: template }]);
    a.vault.adapter = adapter;
    a.workspace.getLeavesOfType = () => leaves;
    a.workspace.revealLeaf = (l) => revealed.push(l);
    a.workspace.getLeaf = () => ({ detached: false, detach() { this.detached = true; const i = leaves.indexOf(this); if (i >= 0) leaves.splice(i, 1); }, async setViewState(st) { created.push(this); this.view = p.views[st.type](this); this.app = a; leaves.push(this); await this.view.open(document.body); } });
    return a;
  };
  const app10 = mkApp();
  const p = new Plugin(app10, { version: "test", dir: ".obsidian/plugins/zotero-library" });
  await p.onload();
  p.settings.zoteroDataDir = golden.dataDir;
  await p.activateView();
  check("10) sin pestañas: se crea una", created.length === 1 && leaves.length === 1);
  await leaves[0].view.ready;
  check("10) la vista queda sana", leaves[0].view.health() === "ready", leaves[0].view.health());
  await p.activateView();
  check("10) con una sana: se trae al frente sin crear otra", created.length === 1 && revealed.length >= 1 && leaves.length === 1);
  const broken = { view: {}, detached: false, detach() { this.detached = true; const i = leaves.indexOf(this); if (i >= 0) leaves.splice(i, 1); } };
  const healthyLeaf = leaves[0];
  leaves.length = 0; leaves.push(broken);
  await p.activateView();
  check("10) una pestaña rota (sin vista) se cierra y se crea otra", broken.detached && created.length === 2 && leaves.length === 1);
  await leaves[0].view.ready;
  await p.activateView(true);
  check("10) «Reiniciar la vista» recrea aunque la actual esté sana", created.length === 3 && leaves.length === 1);
  await leaves[0].view.ready;
  // vista fallida: Zotero cerrado y sin copia
  disk.clear(); server.down = true;
  leaves.length = 0;
  p.index = null;
  await p.activateView();
  await leaves[0].view.ready;
  check("10) con la carga imposible la vista queda marcada como fallida", leaves[0].view.health() === "failed", leaves[0].view.health());
  server.down = false;
  const failedLeaf = leaves[0];
  await p.activateView();
  check("10) una vista fallida se sustituye por otra nueva", failedLeaf.detached && created.length === 5 && leaves.length === 1);
  await leaves[0].view.ready;
  check("10) y la nueva carga bien", leaves[0].view.health() === "ready" && $$(".zl-items .zl-vrow", leaves[0].view.contentEl).length === 2, leaves[0].view.health());
  check("10) la barra muestra la versión", /^v\d/.test($(".zl-version", leaves[0].view.contentEl)?.textContent ?? "") || $(".zl-version", leaves[0].view.contentEl)?.textContent === "vtest", $(".zl-version", leaves[0].view.contentEl)?.textContent);
}

console.log(failures ? `\n${failures} comprobación(es) fallida(s)` : "\nRESULTADO: copia en disco y sincronización funcionan de principio a fin");
process.exit(failures ? 1 : 0);

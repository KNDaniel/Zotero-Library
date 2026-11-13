// Prueba de humo del paquete (main.js): API falsa -> carga -> plantilla -> comparación con la nota.
import Module from "node:module";
import { ITEM, appWith, entities, makeObsidian, note, requests, mainUrl, template, golden } from "./fake-zotero.mjs";

const obsidian = makeObsidian();
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === "obsidian" ? obsidian : origLoad.call(this, request, ...rest); };

const mod = await import(mainUrl);
const Plugin = mod.default?.default ?? mod.default;
const tplFile = new obsidian.TFile("Zotero Library/Plantillas/import.md");
const p = new Plugin(appWith([{ file: tplFile, content: template }]), { version: "test" });
await p.onload();
p.settings.zoteroDataDir = golden.dataDir;
console.log("comandos:", Object.keys(p.commands).join(", "));
await p.loadLibrary(false);
console.log("índice:", JSON.stringify(p.index.stats()), "| descarga:", p.index.fetchMode, "| cabecera Allowed:", requests[0].headers["Zotero-Allowed-Request"]);
const out = await p.renderItemTemplate("import.md", ITEM);
if (out !== note) { console.log("RESULTADO: HAY DIFERENCIAS"); process.exit(1); }
console.log("RESULTADO: la nota generada por el paquete es IDÉNTICA a tu nota de referencia");

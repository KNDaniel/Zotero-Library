// Vuelca el DOM de la vista montada (jsdom + Zotero simulado) para medirlo en un Chromium real.
import Module from "node:module";
import { writeFileSync } from "node:fs";
import { installDom, sleep } from "./dom-polyfill.mjs";
import { appWith, makeObsidian, mainUrl, golden } from "./fake-zotero.mjs";

installDom();
const obsidian = makeObsidian({ MarkdownRenderer: { render: async (_a, md, el) => { el.textContent = md; } } });
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === "obsidian" ? obsidian : origLoad.call(this, request, ...rest); };
const mod = await import(mainUrl);
const Plugin = mod.default?.default ?? mod.default;
const p = new Plugin(appWith([]), { version: "test" });
await p.onload();
p.settings.zoteroDataDir = golden.dataDir;
const view = p.views["zotero-library-view"]({ app: appWith([]) });
await view.open(document.body);
await view.ready;
await sleep(300);
// Estado para la revisión visual: agrupado por colección y con dos ítems seleccionados
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
if (process.env.ZL_DEMO) {
  const sel = [...document.querySelectorAll(".zl-items .zl-simple, .zl-items select")];
  const groupSel = document.querySelectorAll(".zl-list-opts select")[1];
  groupSel.value = "collection"; groupSel.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(200);
  for (const r of [...document.querySelectorAll(".zl-items .zl-item-row")].slice(0, 2)) click(r);
  await sleep(300);
  click(document.querySelector(".zl-help-btn"));
}
writeFileSync(process.argv[2] ?? "/tmp/view.html", document.body.innerHTML);
process.exit(0);

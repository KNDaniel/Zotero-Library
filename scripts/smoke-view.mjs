// Prueba de humo de la VISTA con el paquete real: jsdom + Obsidian y Zotero simulados.
// Simula clics y escritura como lo haría una persona.
import Module from "node:module";
import { $, $$, click, installDom, sleep } from "./dom-polyfill.mjs";
import { ITEM, appWith, makeObsidian, mainUrl, template, golden } from "./fake-zotero.mjs";

installDom();

const rendered = [];
const obsidian = makeObsidian({
  MarkdownRenderer: { render: async (_app, md, el) => { rendered.push(md); el.textContent = md; } },
});
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === "obsidian" ? obsidian : origLoad.call(this, request, ...rest); };

const mod = await import(mainUrl);
const Plugin = mod.default?.default ?? mod.default;
const files = [{ file: new obsidian.TFile("Zotero Library/Plantillas/import.md"), content: template }];
const app = appWith(files);
const p = new Plugin(app, { version: "test" });
await p.onload();
p.settings.zoteroDataDir = golden.dataDir;

let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };

const view = p.views["zotero-library-view"]({ app });
await view.open(document.body);
await view.ready;
await sleep(150);

check("la vista monta los tres paneles", !!$(".zl-items") && !!$(".zl-tags") && !!$(".zl-results"));
const panelInstances = [$(".zl-items"), $(".zl-tags"), $(".zl-results")];
check("navegación estrecha: tres pestañas con Resultados activo por defecto", $$(".zl-panel-tabs .zl-panel-tab").length === 3 && $(".zl-panel-tabs .zl-panel-tab[aria-pressed='true']")?.textContent === "Resultados");
for (const tab of $$(".zl-panel-tabs .zl-panel-tab")) {
  click(tab);
  const active = tab.textContent === "Ítems" ? $(".zl-items") : tab.textContent === "Etiquetas" ? $(".zl-tags") : $(".zl-results");
  check(`navegación: ${tab.textContent} activa su panel sin desmontar los demás`, active.classList.contains("is-active-panel") && panelInstances.every((el, i) => el === [$(".zl-items"), $(".zl-tags"), $(".zl-results")][i]));
}
click($(".zl-panel-tabs .zl-panel-tab[aria-pressed='true']"));
check("barra superior: origen de la carga y estado", /^Zotero \d+\.\d s$/.test($(".zl-origin").textContent) && $(".zl-origin").classList.contains("is-zotero"), $(".zl-origin").textContent);
check("barra superior: ya no muestra el recuento", !$(".zl-stats"));
check("lista de ítems con los 2 ítems", $$(".zl-items .zl-vrow").length === 2);
check("sin selección: invitación en resultados", $(".zl-results .zl-empty")?.textContent.includes("Selecciona uno o más ítems"));
check("sin selección: panel de etiquetas vacío", $$(".zl-tags .zl-vrow").length === 0);

// Búsqueda rápida: solo el ítem sintético
const search = $(".zl-simple input");
search.value = "@autor: Example | @colección: Synthetic"; search.dispatchEvent(new window.Event("input", { bubbles: true }));
await sleep(150);
check("búsqueda rápida filtra", $$(".zl-items .zl-vrow").length === 1, $(".zl-items .zl-count").textContent);

// Seleccionar el ítem
click($(".zl-items .zl-vrow"));
await sleep(200);
check("ítem seleccionado", $(".zl-items .zl-count").textContent === "1 seleccionado de 1");
check("modo ítem: una tarjeta con la plantilla por defecto", $$(".zl-card").length === 1 && /\[Zotero\]\(zotero:\/\/(open|select)\//.test($(".zl-card").textContent) && !$(".zl-card").textContent.includes("anotaciones"), $(".zl-card")?.textContent.slice(0, 60).replace(/\n/g, " "));
check("etiquetas de las anotaciones del ítem", $$(".zl-tags .zl-vrow").length > 5, `${$(".zl-tags .zl-count").textContent}`);

// Modo anotación
click($$(".zl-results .zl-panel-head .zl-seg button")[1]);
await sleep(200);
check("modo anotación: primer lote de tarjetas", $$(".zl-card").length === 30, `${$$(".zl-card").length}`);
check("«Mostrar más» con las restantes", $(".zl-more .zl-btn")?.textContent === "Mostrar más (41 restantes)", $(".zl-more .zl-btn")?.textContent);
click($(".zl-more .zl-btn")); await sleep(200);
click($(".zl-more .zl-btn")); await sleep(200);
check("se llega a las 71 tarjetas", $$(".zl-card").length === 71 && !$(".zl-more"), `${$$(".zl-card").length}`);
check("las imágenes usan la caché de Zotero", rendered.some((m) => m.includes('<img src="file:///') && m.includes("/cache/library/")));
check("tarjetas con color de la anotación", $$(".zl-card").every((c) => c.style.borderLeftColor));

// Etiqueta: clic en una insignia
const badge = $(".zl-badge");
const tag = badge.textContent;
click(badge); await sleep(250);
check("insignia seleccionada filtra las tarjetas", $$(".zl-card").length > 0 && $$(".zl-card").length < 71, `${tag}: ${$$(".zl-card").length} tarjetas; ${$(".zl-results .zl-count").textContent}`);
check("chip de etiqueta elegida", $(".zl-chips .zl-chip")?.textContent.startsWith(tag));
click($(".zl-chips .zl-chip")); await sleep(250);
check("quitar la etiqueta restaura las tarjetas", $$(".zl-card").length === 30);

// Plantilla propia del usuario como plantilla de renderizado de ítems (se le quita el frontmatter)
p.settings.defaultItemRender = "import.md";
click($$(".zl-results .zl-panel-head .zl-seg button")[0]); await sleep(300);
const card = $(".zl-card")?.textContent ?? "";
check("modo ítem con la plantilla: sin frontmatter y con la metadata", !card.includes("titulo:") && card.includes("Metadata") && card.includes("Anotaciones."), card.slice(0, 40).replace(/\n/g, " "));

// Error de plantilla visible, sin romper la vista
p.settings.defaultItemRender = "";
files[0].content = "{% if %}";
p.settings.defaultItemRender = "import.md";
click($$(".zl-results .zl-panel-head .zl-seg button")[1]); await sleep(100);
click($$(".zl-results .zl-panel-head .zl-seg button")[0]); await sleep(300);
check("un error de plantilla se muestra en la tarjeta", $(".zl-error")?.textContent.startsWith("Error en la plantilla"), $(".zl-error")?.textContent.slice(0, 60));

// 0.9.3: menú contextual, colecciones flotantes y casilla de grupo
const clickEl = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
const row = $(".zl-items .zl-item-row");
globalThis.__menus = [];
row.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
const menu = globalThis.__menus.at(-1);
check("clic derecho: menú con abrir y encontrar, en Zotero y en local", menu?.shown && menu.items.map((i) => i.title).join("|") === "Abrir en Zotero|Encontrar en Zotero|Abrir local|Encontrar local", menu?.items.map((i) => i.title).join("|"));
check("clic derecho: «Encontrar en Zotero» abre el enlace del ítem", (() => { const opened = []; window.open = (u) => opened.push(u); menu.items[1].click(); return opened[0]?.startsWith("zotero://select/library/items/"); })());
clickEl($(".zl-coll-btn")); await sleep(50);
const float = $$(".zl-float-collections").at(-1);
check("colecciones: el desplegable flotante se abre y cuelga del body", float && !float.classList.contains("is-hidden") && float.parentElement === document.body);
document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })); await sleep(20);
check("colecciones: un clic fuera lo cierra", float.classList.contains("is-hidden"));
check("búsqueda: solo «Buscar…» y un «?»", $(".zl-items .zl-simple input").placeholder === "Buscar…" && !!$(".zl-items .zl-simple .zl-help-btn") && !$(".zl-items .zl-hint"));
check("barra de selección: Y|O seguido de Todos|Ninguno", [...$$(".zl-items .zl-search-modes .zl-actions .zl-seg")].map((x) => x.textContent).join("|") === "YO|TodosNinguno");
check("filas con el total de anotaciones del ítem", [...$$(".zl-items .zl-ann-count")].length > 0, String($$(".zl-items .zl-ann-count").length));

// Una sincronización con cambios actualiza los datos sin desmontar los paneles ni perder su estado local.
const panelNodes = [$(".zl-items"), $(".zl-tags"), $(".zl-results")];
const scrollNodes = [$(".zl-items .zl-vlist"), $(".zl-tags .zl-vlist"), $(".zl-results .zl-results-body")];
const selectionCount = $(".zl-items .zl-count")?.textContent;
scrollNodes.forEach((el, i) => { el.scrollTop = 20 + i * 10; });
const groupRow = $(".zl-items .zl-group-row");
click(groupRow); // plegar el grupo
const groupChevron = $(".zl-items .zl-group-row")?.querySelector(".zl-chevron")?.textContent;
p.syncLibrary = async () => ({ status: "incremental", index: p.getIndex(), ms: 1 });
for (let i = 0; i < 3; i++) await view.sync();
await sleep(200);
check("sincronizar conserva las instancias de los paneles", panelNodes.every((el, i) => el === [$(".zl-items"), $(".zl-tags"), $(".zl-results")][i]));
check("sincronizar conserva la posición de desplazamiento", scrollNodes.every((el, i) => el.scrollTop === 20 + i * 10));
check("sincronizar conserva la selección", $(".zl-items .zl-count")?.textContent === selectionCount, selectionCount);
check("sincronizar conserva el plegado de los grupos", $(".zl-items .zl-group-row")?.querySelector(".zl-chevron")?.textContent === groupChevron, `${groupChevron} → ${$(".zl-items .zl-group-row")?.querySelector(".zl-chevron")?.textContent}`);

// Persistencia del estado
await sleep(800);
check("el estado se guarda (búsqueda y modo)", p._data.viewState?.searchText === "@autor: Example | @colección: Synthetic" && p._data.viewState?.mode === "item" && !("selectedItems" in p._data.viewState));

console.log(failures ? `\n${failures} comprobación(es) fallida(s)` : "\nRESULTADO: la vista funciona de principio a fin");
process.exit(failures ? 1 : 0);

// API de Zotero sintética de escala para la bóveda vault-pruebas-escala.
// Solo escucha en loopback, acepta GET y genera datos ficticios en memoria.
import http from "node:http";

const HOST = "127.0.0.1";
const PORT = 23122;
const ITEM_COUNT = 620;
const ANNOTATION_COUNT = 10_500;
const base = { dateAdded: "2025-01-01T00:00:00Z", dateModified: "2025-01-01T00:00:00Z", version: 1, tags: [], relations: {} };
const collections = Array.from({ length: 20 }, (_, i) => {
  const key = `SC${String(i).padStart(6, "0")}`;
  return { key, version: 1, data: { ...base, key, itemType: "collection", name: `Colección sintética ${i}`, parentCollection: false } };
});
const entities = [];
for (let i = 0; i < ITEM_COUNT; i++) {
  const key = `SI${String(i).padStart(6, "0")}`;
  entities.push({ key, version: 1, data: { ...base, key, itemType: "book", title: `Ítem sintético ${i}`, creators: [{ creatorType: "author", firstName: "Prueba", lastName: `Autor${i % 80}` }], date: String(1980 + i % 45), collections: [`SC${String(i % collections.length).padStart(6, "0")}`], tags: [{ tag: `etiqueta-${i % 120}`, type: 0 }], abstractNote: `Resumen ficticio de escala para el ítem ${i}.` } });
}
for (let i = 0; i < ITEM_COUNT; i++) {
  const key = `SA${String(i).padStart(6, "0")}`;
  entities.push({ key, version: 1, data: { ...base, key, itemType: "attachment", parentItem: `SI${String(i).padStart(6, "0")}`, title: `PDF sintético ${i}`, linkMode: "imported_file", contentType: "application/pdf", filename: `${key}.pdf` } });
}
for (let i = 0; i < ANNOTATION_COUNT; i++) {
  const key = `SN${String(i).padStart(6, "0")}`;
  const parent = `SA${String(i % ITEM_COUNT).padStart(6, "0")}`;
  entities.push({ key, version: 1, data: { ...base, key, itemType: "annotation", parentItem: parent, annotationType: i % 3 === 0 ? "note" : "highlight", annotationText: `Texto sintético de anotación ${i}.`, annotationComment: i % 4 === 0 ? `Comentario ficticio ${i}.` : "", annotationColor: i % 2 ? "#ffd400" : "#2ea8e5", annotationPageLabel: String(i % 400 + 1), annotationSortIndex: `${String(i).padStart(8, "0")}|000000|00100`, annotationPosition: { pageIndex: i % 400, rects: [[10, 20, 30, 40]] }, tags: [{ tag: `etiqueta-${i % 120}`, type: 0 }] } });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Zotero-API-Version", "3");
  res.setHeader("Last-Modified-Version", "1");
  if (req.method !== "GET") return res.writeHead(405).end("GET only");
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (url.pathname === "/api/") return res.writeHead(200, { "Content-Type": "application/json" }).end('{"version":3}');
  let list;
  if (url.pathname === "/api/users/0/collections") list = collections;
  else if (url.pathname === "/api/users/0/items") list = entities;
  else return res.writeHead(404).end("Synthetic scale fixture only");
  const itemType = url.searchParams.get("itemType");
  if (itemType) list = list.filter((entry) => entry.data.itemType === itemType);
  const total = list.length;
  const start = Number(url.searchParams.get("start") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? total);
  const page = list.slice(start, start + limit);
  res.setHeader("Total-Results", String(total));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.writeHead(200).end(JSON.stringify(page));
});

server.listen(PORT, HOST, () => console.log(`Synthetic scale API ready at http://${HOST}:${PORT}/api/ — ${ITEM_COUNT} items, ${ANNOTATION_COUNT} annotations`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

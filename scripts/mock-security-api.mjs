// Zotero API sintética para la prueba D2 de sanitización en Obsidian.
// Solo escucha en loopback, acepta GET y entrega cuatro anotaciones de prueba.
import http from "node:http";

const HOST = "127.0.0.1";
const PORT = 23121;
const ITEM = "D2ITEM01";
const ATTACHMENT = "D2FILE01";
const date = "2026-01-01T00:00:00Z";
const base = { dateAdded: date, dateModified: date, version: 1, tags: [], relations: {} };
const entities = [
  { key: ITEM, version: 1, data: { ...base, key: ITEM, itemType: "book", title: "Biblioteca sintética D2", date: "2026", creators: [{ creatorType: "author", firstName: "Prueba", lastName: "D2" }], collections: [] } },
  { key: ATTACHMENT, version: 1, data: { ...base, key: ATTACHMENT, itemType: "attachment", parentItem: ITEM, title: "Adjunto sintético", linkMode: "imported_file", contentType: "application/pdf", filename: "d2-sintetico.pdf" } },
  { key: "D2ANN001", version: 1, data: { ...base, key: "D2ANN001", itemType: "annotation", parentItem: ATTACHMENT, annotationType: "highlight", annotationText: "<strong>D2 HTML benigno</strong>", annotationComment: "D2 HTML benigno", annotationColor: "#ffd400", annotationPageLabel: "1", annotationSortIndex: "00001|000000|00000", annotationPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } } },
  { key: "D2ANN002", version: 1, data: { ...base, key: "D2ANN002", itemType: "annotation", parentItem: ATTACHMENT, annotationType: "highlight", annotationText: "<script>document.title='D2_SCRIPT_EXECUTED'</script>", annotationComment: "D2 elemento script", annotationColor: "#ffd400", annotationPageLabel: "2", annotationSortIndex: "00002|000000|00000", annotationPosition: { pageIndex: 1, rects: [[1, 2, 3, 4]] } } },
  { key: "D2ANN003", version: 1, data: { ...base, key: "D2ANN003", itemType: "annotation", parentItem: ATTACHMENT, annotationType: "highlight", annotationText: "<img src=\"missing-d2-event.png\" onerror=\"document.title='D2_EVENT_EXECUTED'\">", annotationComment: "D2 atributo onerror", annotationColor: "#ffd400", annotationPageLabel: "3", annotationSortIndex: "00003|000000|00000", annotationPosition: { pageIndex: 2, rects: [[1, 2, 3, 4]] } } },
  { key: "D2ANN004", version: 1, data: { ...base, key: "D2ANN004", itemType: "annotation", parentItem: ATTACHMENT, annotationType: "highlight", annotationText: "<a href=\"javascript:document.title='D2_URL_EXECUTED'\">D2 JavaScript URL</a>", annotationComment: "D2 URL JavaScript", annotationColor: "#ffd400", annotationPageLabel: "4", annotationSortIndex: "00004|000000|00000", annotationPosition: { pageIndex: 3, rects: [[1, 2, 3, 4]] } } },
];

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Zotero-API-Version", "3");
  res.setHeader("Last-Modified-Version", "1");
  if (req.method !== "GET") return res.writeHead(405).end("GET only");
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (url.pathname === "/api/") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.writeHead(200).end(JSON.stringify({ version: 3 }));
  }
  if (url.pathname === "/api/users/0/collections") {
    res.setHeader("Total-Results", "0");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.writeHead(200).end("[]");
  }
  if (url.pathname !== "/api/users/0/items") return res.writeHead(404).end("Synthetic fixture endpoint only");
  const itemType = url.searchParams.get("itemType");
  const selected = itemType ? entities.filter((entry) => entry.data.itemType === itemType) : entities;
  res.setHeader("Total-Results", String(selected.length));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.writeHead(200).end(JSON.stringify(selected));
});

server.listen(PORT, HOST, () => console.log(`D2 synthetic API ready at http://${HOST}:${PORT}/api/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

// API local sintética para inspección visual del plugin en Obsidian.
// Solo escucha en loopback, solo acepta GET y solo sirve fixtures del repositorio.
import http from "node:http";
import { entities, collectionsList } from "./fake-zotero.mjs";

const HOST = "127.0.0.1";
const PORT = 23120;
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Zotero-API-Version", "3");
  res.setHeader("Last-Modified-Version", "7");
  if (req.method !== "GET") {
    res.writeHead(405).end("GET only");
    return;
  }

  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (!url.pathname.startsWith("/api/users/0/")) {
    res.writeHead(404).end("Synthetic fixture endpoint only");
    return;
  }
  const list = url.pathname.endsWith("/collections") ? collectionsList : url.pathname.includes("/items") ? entities : null;
  if (!list) {
    res.writeHead(404).end("Synthetic fixture endpoint only");
    return;
  }

  const itemType = url.searchParams.get("itemType");
  const selected = itemType ? list.filter((entry) => entry.data?.itemType === itemType) : list;
  res.setHeader("Total-Results", String(selected.length));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(200).end(JSON.stringify(selected));
});

server.listen(PORT, HOST, () => console.log(`Synthetic Zotero API ready at http://${HOST}:${PORT}/api/`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));

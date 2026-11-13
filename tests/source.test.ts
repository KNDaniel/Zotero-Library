import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import type { ZoteroApiObject } from "../src/model/types";
import type { HttpClient, HttpResponse } from "../src/source/http";
import { ZoteroConnectionError } from "../src/source/http";
import { LocalApiSource } from "../src/source/LocalApiSource";
import { annotation, attachment, collection, item } from "./fixtures";

function resp(json: unknown, headers: Record<string, string> = {}, status = 200): HttpResponse {
  return { status, headers, text: JSON.stringify(json), json };
}

/** Servidor falso: pagina /items y /collections respetando limit/start. */
function fakeServer(items: ZoteroApiObject[], collections: ZoteroApiObject[], opts: { totalHeader?: boolean } = {}) {
  const calls: string[] = [];
  const http: HttpClient = async ({ url }) => {
    calls.push(url);
    const u = new URL(url);
    const list = u.pathname.endsWith("/collections") ? collections : items;
    const limit = Number(u.searchParams.get("limit") ?? 25);
    const start = Number(u.searchParams.get("start") ?? 0);
    const headers: Record<string, string> = { "last-modified-version": "42" };
    if (opts.totalHeader !== false) headers["total-results"] = String(list.length);
    return resp(list.slice(start, start + limit), headers);
  };
  return { http, calls };
}

const mk = (n: number): ZoteroApiObject[] =>
  Array.from({ length: n }, (_, i) => item(`ITEM${String(i).padStart(4, "0")}`));

describe("LocalApiSource", () => {
  it("pagina en orden y reúne todas las entidades", async () => {
    const items = mk(250);
    const { http, calls } = fakeServer(items, []);
    const src = new LocalApiSource({ baseUrl: "http://localhost:23119/", libraryPath: "/users/0/", http });
    const raw = await src.fetchLibrary();
    expect(raw.entities.map((e) => e.key)).toEqual(items.map((e) => e.key));
    expect(raw.total).toBe(250);
    expect(raw.libraryVersion).toBe(42);
    expect(raw.truncated).toBe(false);
    expect(calls).toContain("http://localhost:23119/api/users/0/items?limit=100&start=0");
  });

  it("sin Total-Results sigue hasta una página incompleta", async () => {
    const items = mk(230);
    const { http } = fakeServer(items, [], { totalHeader: false });
    const src = new LocalApiSource({ baseUrl: "http://localhost:23119", libraryPath: "users/0", http });
    const raw = await src.fetchLibrary();
    expect(raw.entities).toHaveLength(230);
  });

  it("envía la cabecera de versión de la API", async () => {
    let seen: Record<string, string> | undefined;
    const http: HttpClient = async (req) => {
      seen = req.headers;
      return resp([], { "total-results": "0" });
    };
    await new LocalApiSource({ baseUrl: "http://localhost:23119", libraryPath: "users/0", http }).ping();
    expect(seen?.["Zotero-API-Version"]).toBe("3");
  });

  it("traduce 403, 404 y fallos de red a errores con pista", async () => {
    const mkSrc = (http: HttpClient) =>
      new LocalApiSource({ baseUrl: "http://localhost:23119", libraryPath: "users/0", http });

    const e403 = await mkSrc(async () => resp({}, {}, 403)).ping().catch((e) => e);
    expect(e403).toBeInstanceOf(ZoteroConnectionError);
    expect(e403.status).toBe(403);
    expect(e403.hint).toContain("Permitir que otras aplicaciones");

    const e404 = await mkSrc(async () => resp({}, {}, 404)).ping().catch((e) => e);
    expect(e404.hint).toContain("ruta de la biblioteca");

    const eNet = await mkSrc(async () => {
      throw new Error("ECONNREFUSED");
    })
      .ping()
      .catch((e) => e);
    expect(eNet).toBeInstanceOf(ZoteroConnectionError);
    expect(eNet.message).toContain("ECONNREFUSED");
  });
});

describe("LibraryIndex", () => {
  const entities = [
    item("ITEMAAAA", { collections: ["COLLROOT"] }, { parsedDate: "2010-06" }),
    item("ITEMBBBB", { collections: ["COLLCHLD"], relations: { "dc:relation": "http://zotero.org/users/1/items/ITEMAAAA" } }),
    item("ITEMCCCC"),
    attachment("ATTAAAAA", "ITEMAAAA"),
    attachment("ATTSOLO1", null),
    attachment("ATTORFAN", "NOEXISTE"),
    annotation("ANNOT002", "ATTAAAAA", { annotationSortIndex: "00007|001300|00100", tags: [{ tag: "Tomo I", type: 0 }] }),
    annotation("ANNOT001", "ATTAAAAA", {
      annotationSortIndex: "00007|001200|00100",
      annotationColor: "#123456",
      tags: [{ tag: "Tomo I", type: 0 }, { tag: "1867", type: 0 }],
    }),
    annotation("ANNOT003", "ATTSOLO1"),
    annotation("ANNOT004", "NOHAYADJ"),
    annotation("ANNOT005", "ATTAAAAA", { annotationPosition: "roto" }),
  ];
  const cols = [collection("COLLROOT", "Raíz"), collection("COLLCHLD", "Hija", "COLLROOT"), collection("COLLOTRA", "Otra")];
  const index = LibraryIndex.fromRaw({
    entities,
    collections: cols,
    libraryVersion: 7,
    total: entities.length,
    truncated: false,
  });

  it("cuenta las entidades por tipo", () => {
    expect(index.stats()).toMatchObject({ items: 3, attachments: 3, annotations: 5, collections: 3, libraryVersion: 7 });
  });

  it("une anotación -> adjunto -> ítem y ordena por sortIndex", () => {
    expect(index.annotationsOf("ITEMAAAA").map((a) => a.key)).toEqual(["ANNOT001", "ANNOT005", "ANNOT002"]);
    expect(index.annotationsOf("ITEMAAAA")[0].key).toBe("ANNOT001");
    expect(index.itemKeyOf(index.annotations.get("ANNOT001")!)).toBe("ITEMAAAA");
    expect(index.items.get("ITEMAAAA")!.attachmentKeys).toEqual(["ATTAAAAA"]);
  });

  it("trata los PDF sueltos y los huérfanos", () => {
    const d = index.diagnostics;
    expect(d.standaloneAttachments).toEqual(["ATTSOLO1"]);
    expect(d.annotationsOfStandalone).toEqual(["ANNOT003"]);
    expect(d.orphanAttachments).toEqual(["ATTORFAN"]);
    expect(d.orphanAnnotations).toEqual(["ANNOT004"]);
    expect(d.nonStandardColors).toEqual(["ANNOT001"]);
    expect(d.unparsablePositions).toEqual(["ANNOT005"]);
    expect(d.nonPdfPositions).toEqual([]);
    expect(index.itemKeyOf(index.annotations.get("ANNOT003")!)).toBe("ATTSOLO1");
    expect(index.annotationsOf("ATTSOLO1").map((a) => a.key)).toEqual(["ANNOT003"]);
  });

  it("resuelve colecciones con y sin subcolecciones", () => {
    expect([...index.collectionWithDescendants("COLLROOT")].sort()).toEqual(["COLLCHLD", "COLLROOT"]);
    expect([...index.itemKeysInCollections(["COLLROOT"], true)].sort()).toEqual(["ITEMAAAA", "ITEMBBBB"]);
    expect([...index.itemKeysInCollections(["COLLROOT"], false)]).toEqual(["ITEMAAAA"]);
    expect([...index.itemKeysInCollections(["COLLOTRA"], true)]).toEqual([]);
  });

  it("cuenta etiquetas de anotaciones y resuelve relacionados", () => {
    const counts = index.annotationTagCounts(index.annotationsOf("ITEMAAAA"));
    expect(counts.get("Tomo I")).toBe(2);
    expect(counts.get("1867")).toBe(1);
    expect(index.relatedItems(index.items.get("ITEMBBBB")!).map((i) => i.key)).toEqual(["ITEMAAAA"]);
  });

  it("una entidad rota no impide cargar el resto", () => {
    const broken = [item("OKOKOKOK"), { key: "BROKEN01", version: 1 } as unknown as ZoteroApiObject];
    const idx = LibraryIndex.fromRaw({ entities: broken, collections: [], libraryVersion: 1, total: 2, truncated: false });
    expect(idx.items.size).toBe(1);
    expect(idx.diagnostics.failed).toHaveLength(1);
  });
});

describe("carga sin paginar y paginación adaptativa", () => {
  const mkSrc = (http: HttpClient) =>
    new LocalApiSource({ baseUrl: "http://127.0.0.1:23119", libraryPath: "users/0", http });

  /** Servidor que entrega todo si no se pide límite y respeta un tope si se pide. */
  function server(items: ZoteroApiObject[], opts: { unpaged: boolean; cap?: number }) {
    const calls: string[] = [];
    const http: HttpClient = async ({ url }) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith("/collections")) return resp([], { "total-results": "0" });
      const hasLimit = u.searchParams.has("limit");
      const limit = hasLimit ? Math.min(Number(u.searchParams.get("limit")), opts.cap ?? Infinity) : opts.unpaged ? Infinity : 25;
      const start = Number(u.searchParams.get("start") ?? 0);
      return resp(items.slice(start, start + limit), { "total-results": String(items.length), "last-modified-version": "5" });
    };
    return { http, calls };
  }

  it("si el servidor entrega todo sin límite, basta una petición para los ítems", async () => {
    const { http, calls } = server(mk(500), { unpaged: true });
    const raw = await mkSrc(http).fetchLibrary();
    expect(raw.entities).toHaveLength(500);
    expect(raw.fetchMode).toBe("unpaged");
    expect(calls.filter((c) => c.includes("/items")).length).toBeLessThanOrEqual(3); // ítems + (vías de anotaciones)
    expect(calls.some((c) => c.includes("limit="))).toBe(false);
  });

  it("si pagina por defecto, cae a paginar y no se queda con la primera página", async () => {
    const { http } = server(mk(250), { unpaged: false });
    const raw = await mkSrc(http).fetchLibrary();
    expect(raw.entities).toHaveLength(250);
    expect(raw.fetchMode).toBe("paged");
  });

  it("si el servidor recorta las páginas por debajo del límite, avanza con su tamaño real", async () => {
    const items = mk(130);
    const { http } = server(items, { unpaged: false, cap: 50 });
    const raw = await mkSrc(http).fetchLibrary();
    expect(raw.entities.map((e) => e.key)).toEqual(items.map((e) => e.key));
    expect(raw.truncated).toBe(false);
  });

  it("cuenta las peticiones realizadas", async () => {
    const { http } = server(mk(10), { unpaged: true });
    const raw = await mkSrc(http).fetchLibrary();
    expect(raw.requests).toBeGreaterThan(0);
  });
});

describe("orden de lectura con empates de sortIndex", () => {
  const same = "00008|000000|00000";
  const build = (anns: ZoteroApiObject[]) =>
    LibraryIndex.fromRaw({ entities: [item("ITEMAAAA"), attachment("ATTAAAAA", "ITEMAAAA"), ...anns], collections: [], libraryVersion: 1, total: 0, truncated: false });

  it("si el sortIndex empata, va primero la anotación más antigua, aunque su clave sea posterior", () => {
    const idx = build([
      annotation("PSMEH7YG", "ATTAAAAA", { annotationSortIndex: same, dateAdded: "2024-05-02T10:00:00Z" }),
      annotation("UK83PLMA", "ATTAAAAA", { annotationSortIndex: same, dateAdded: "2024-05-02T09:00:00Z" }),
    ]);
    expect(idx.annotationsOf("ITEMAAAA").map((a) => a.key)).toEqual(["UK83PLMA", "PSMEH7YG"]);
  });

  it("si también empata la fecha, se desempata por clave", () => {
    const idx = build([
      annotation("BBBBBBBB", "ATTAAAAA", { annotationSortIndex: same, dateAdded: "2024-05-02T09:00:00Z" }),
      annotation("AAAAAAAA", "ATTAAAAA", { annotationSortIndex: same, dateAdded: "2024-05-02T09:00:00Z" }),
    ]);
    expect(idx.annotationsOf("ITEMAAAA").map((a) => a.key)).toEqual(["AAAAAAAA", "BBBBBBBB"]);
  });

  it("el sortIndex manda sobre la fecha de alta", () => {
    const idx = build([
      annotation("OLDOLDOL", "ATTAAAAA", { annotationSortIndex: "00009|000000|00000", dateAdded: "2020-01-01T00:00:00Z" }),
      annotation("NEWNEWNE", "ATTAAAAA", { annotationSortIndex: "00008|000000|00000", dateAdded: "2025-01-01T00:00:00Z" }),
    ]);
    expect(idx.annotationsOf("ITEMAAAA").map((a) => a.key)).toEqual(["NEWNEWNE", "OLDOLDOL"]);
  });
});

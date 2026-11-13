import { describe, expect, it } from "vitest";
import { CACHE_SCHEMA, mergeChanges, packCache, unpackCache } from "../src/index/cache";
import { LibraryIndex } from "../src/index/LibraryIndex";
import type { ZoteroApiObject } from "../src/model/types";
import type { HttpClient, HttpResponse } from "../src/source/http";
import { LocalApiSource } from "../src/source/LocalApiSource";
import type { RawLibrary } from "../src/source/ZoteroSource";
import { annotation, attachment, collection, item } from "./fixtures";

const raw = (): RawLibrary => ({
  entities: [item("ITEMAAAA"), item("ITEMBBBB"), attachment("ATTAAAAA", "ITEMAAAA"), annotation("ANNAAAAA", "ATTAAAAA"), annotation("ANNBBBBB", "ATTAAAAA")],
  collections: [collection("COLAAAAA", "Una"), collection("COLBBBBB", "Otra")],
  libraryVersion: 100,
  total: 5,
  truncated: false,
  annotationSource: "items",
  fetchMode: "unpaged",
});
const keys = (l: ZoteroApiObject[]) => l.map((e) => e.key).sort();
const trashed = (o: ZoteroApiObject): ZoteroApiObject => ({ ...o, data: { ...o.data, deleted: 1 } });

describe("copia en disco", () => {
  it("empaqueta y desempaqueta sin perder nada", async () => {
    const packed = await packCache(raw(), { savedAt: 123, libraryPath: "users/0", plugin: "0.5.0" });
    expect(packed.byteLength).toBeLessThan(JSON.stringify(raw()).length); // comprimida
    const back = await unpackCache(packed);
    expect(back?.meta).toEqual({ schema: CACHE_SCHEMA, savedAt: 123, libraryPath: "users/0", plugin: "0.5.0" });
    expect(back?.raw).toEqual(raw());
    expect(LibraryIndex.fromRaw(back!.raw).stats().annotations).toBe(2);
  });
  it("rechaza copias dañadas, vacías o de otro formato", async () => {
    expect(await unpackCache(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await unpackCache(new Uint8Array())).toBeNull();
    const { gzipSync } = await import("zlib");
    expect(await unpackCache(gzipSync(Buffer.from(JSON.stringify({ meta: { schema: 999 }, raw: raw() }))))).toBeNull();
    expect(await unpackCache(gzipSync(Buffer.from("no es json")))).toBeNull();
  });
  it("el índice se puede reconstruir a partir de su toRaw", () => {
    const idx = LibraryIndex.fromRaw(raw());
    const again = LibraryIndex.fromRaw(idx.toRaw());
    expect(again.stats()).toEqual(idx.stats());
    expect(again.annotationSource).toBe("items");
  });
});

describe("métricas de la última descarga", () => {
  it("fetchedAt y fetchMs sobreviven al índice, a la copia en disco y a la mezcla de cambios", async () => {
    const base = { ...raw(), fetchedAt: 1_700_000_000_000, fetchMs: 41_000 };
    const idx = LibraryIndex.fromRaw(base);
    expect(idx.fetchedAt).toBe(1_700_000_000_000);
    expect(idx.fetchMs).toBe(41_000);
    const packed = await unpackCache(await packCache(idx.toRaw(), { savedAt: 1, libraryPath: "users/0", plugin: "0.6.1" }));
    expect(packed!.raw.fetchedAt).toBe(1_700_000_000_000);
    expect(packed!.raw.fetchMs).toBe(41_000);
    const merged = mergeChanges(packed!.raw, { changed: [], changedCollections: [], deleted: { items: [], collections: [] }, libraryVersion: 101 });
    expect(merged.fetchedAt).toBe(1_700_000_000_000); // una sincronización incremental no es una descarga completa
    expect(merged.fetchMs).toBe(41_000);
  });

  it("una copia anterior a la 0.6.1 sigue abriéndose, sin esos datos", async () => {
    const idx = LibraryIndex.fromRaw(raw());
    expect(idx.fetchedAt).toBeUndefined();
    expect(idx.fetchMs).toBeUndefined();
  });
});

describe("mezcla de cambios", () => {
  const base = raw();
  it("actualiza lo modificado, añade lo nuevo y retira lo eliminado", () => {
    const edited = annotation("ANNAAAAA", "ATTAAAAA", { annotationText: "editado" });
    const merged = mergeChanges(base, {
      changed: [edited, annotation("ANNCCCCC", "ATTAAAAA")],
      changedCollections: [collection("COLCCCCC", "Nueva")],
      deleted: { items: ["ANNBBBBB"], collections: ["COLBBBBB"] },
      libraryVersion: 105,
    });
    expect(keys(merged.entities)).toEqual(["ANNAAAAA", "ANNCCCCC", "ATTAAAAA", "ITEMAAAA", "ITEMBBBB"]);
    expect(merged.entities.find((e) => e.key === "ANNAAAAA")!.data.annotationText).toBe("editado");
    expect(keys(merged.collections)).toEqual(["COLAAAAA", "COLCCCCC"]);
    expect(merged.libraryVersion).toBe(105);
    expect(merged.total).toBe(5);
    expect(base.entities).toHaveLength(5); // no modifica la copia original
  });
  it("lo que pasa a la papelera se retira", () => {
    const merged = mergeChanges(base, { changed: [trashed(item("ITEMBBBB"))], changedCollections: [trashed(collection("COLAAAAA", "Una"))], deleted: { items: [], collections: [] }, libraryVersion: 101 });
    expect(keys(merged.entities)).not.toContain("ITEMBBBB");
    expect(keys(merged.collections)).toEqual(["COLBBBBB"]);
  });
  it("conserva la versión anterior si no llega ninguna", () => {
    expect(mergeChanges(base, { changed: [], changedCollections: [], deleted: { items: [], collections: [] }, libraryVersion: 0 }).libraryVersion).toBe(100);
    expect(mergeChanges(base, { changed: [], changedCollections: [], deleted: { items: [], collections: [] }, libraryVersion: 0 }, 120).libraryVersion).toBe(120);
  });
});

describe("LocalApiSource.fetchChanges", () => {
  const res = (json: unknown, headers: Record<string, string> = {}, status = 200): HttpResponse => ({ status, headers, text: "", json });
  function server(opts: { deleted: "ok" | "404" | "bad" }) {
    const calls: string[] = [];
    const http: HttpClient = async ({ url }) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname.endsWith("/deleted")) {
        if (opts.deleted === "404") return res({}, {}, 404);
        if (opts.deleted === "bad") return res("nada");
        return res({ items: ["GONE0001", 5], collections: ["GONECOL1"], tags: [] });
      }
      const list = u.pathname.endsWith("/collections") ? [collection("COLNEW01", "N")] : [annotation("ANNNEW01", "ATTAAAAA")];
      return res(list, { "total-results": String(list.length), "last-modified-version": "130" });
    };
    return { http, calls };
  }
  const src = (http: HttpClient) => new LocalApiSource({ baseUrl: "http://127.0.0.1:23119", libraryPath: "users/0", http });

  it("pide lo modificado desde la versión, con la papelera, y lee los borrados", async () => {
    const { http, calls } = server({ deleted: "ok" });
    const ch = await src(http).fetchChanges(120);
    expect(ch.changed.map((e) => e.key)).toEqual(["ANNNEW01"]);
    expect(ch.changedCollections.map((c) => c.key)).toEqual(["COLNEW01"]);
    expect(ch.deleted).toEqual({ items: ["GONE0001"], collections: ["GONECOL1"] }); // ignora lo que no es una clave
    expect(ch.libraryVersion).toBe(130);
    expect(calls.some((c) => c.includes("/items") && c.includes("since=120") && c.includes("includeTrashed=1"))).toBe(true);
    expect(calls.some((c) => c.includes("/deleted") && c.includes("since=120"))).toBe(true);
  });
  it("si /deleted no está disponible o es ilegible, deleted es null (habrá que recargar todo)", async () => {
    expect((await src(server({ deleted: "404" }).http).fetchChanges(1)).deleted).toBeNull();
    expect((await src(server({ deleted: "bad" }).http).fetchChanges(1)).deleted).toBeNull();
  });
});

describe("borrados sin /deleted: comparación de claves", () => {
  const res = (json: unknown, headers: Record<string, string> = {}, status = 200, text = ""): HttpResponse => ({ status, headers, text, json });
  const known = (items: string[], collections: string[] = []) => ({ items: new Set(items), collections: new Set(collections) });
  function server(opts: { keysItems?: string | null; keysCols?: string }) {
    const http: HttpClient = async ({ url }) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/deleted")) return res(null, {}, 404);
      if (u.searchParams.get("format") === "keys") {
        const body = u.pathname.endsWith("/collections") ? (opts.keysCols ?? "") : opts.keysItems;
        return body === null || body === undefined ? res([], {}, 200, "[]") : res(null, {}, 200, body);
      }
      return res([], { "total-results": "0", "last-modified-version": "50" });
    };
    return new LocalApiSource({ baseUrl: "http://127.0.0.1:23119", libraryPath: "users/0", http });
  }
  const keysText = (ks: string[]) => ks.join("\n");
  const base = ["AAAAAAA1", "AAAAAAA2", "AAAAAAA3", "AAAAAAA4"];

  it("lo que ya no está en Zotero se marca como borrado", async () => {
    const ch = await server({ keysItems: keysText(["AAAAAAA1", "AAAAAAA3", "NEWKEY01"]), keysCols: "COLAAAA1" }).fetchChanges(10, known(base, ["COLAAAA1", "COLGONE1"]));
    expect(ch.deleted).toEqual({ items: ["AAAAAAA2", "AAAAAAA4"], collections: ["COLGONE1"] });
  });
  it("sin claves conocidas no se puede deducir nada", async () => {
    expect((await server({ keysItems: keysText(base) }).fetchChanges(10)).deleted).toBeNull();
  });
  it("si la API ignora format=keys y devuelve JSON, no se deduce nada", async () => {
    expect((await server({ keysItems: null }).fetchChanges(10, known(base))).deleted).toBeNull();
  });
  it("protección: una lista sospechosamente corta no borra casi toda la biblioteca", async () => {
    const many = Array.from({ length: 100 }, (_, i) => `K${String(i).padStart(7, "0")}`);
    const ch = await server({ keysItems: keysText(many.slice(0, 10)) }).fetchChanges(10, known(many));
    expect(ch.deleted).toBeNull();
  });
  it("fetchKeys: texto vacío = conjunto vacío; JSON = no soportado", async () => {
    expect([...(await server({ keysItems: "", keysCols: "" }).fetchKeys("/collections"))!]).toEqual([]);
    expect(await server({ keysItems: null }).fetchKeys("/items")).toBeNull();
  });
});

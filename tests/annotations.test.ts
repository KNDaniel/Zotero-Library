import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import type { ZoteroApiObject } from "../src/model/types";
import type { HttpClient, HttpResponse } from "../src/source/http";
import { LocalApiSource } from "../src/source/LocalApiSource";
import { annotation, attachment, item } from "./fixtures";

const ok = (json: unknown, total?: number): HttpResponse => ({
  status: 200,
  headers: { "total-results": String(total ?? (Array.isArray(json) ? json.length : 0)), "last-modified-version": "9" },
  text: "",
  json,
});

const base = [item("ITEMAAAA"), attachment("ATTPDF01", "ITEMAAAA", { contentType: "application/pdf" }), attachment("ATTLINK1", "ITEMAAAA", { contentType: "text/plain", linkMode: "linked_url" })];
const anns = [annotation("ANNOT001", "ATTPDF01"), annotation("ANNOT002", "ATTPDF01", { annotationSortIndex: "00008|000001|00001" })];

/** Servidor falso configurable según qué vías de anotaciones soporta. */
function server(opts: { inItems?: boolean; viaFilter?: boolean; viaChildren?: boolean; childrenFails?: boolean }) {
  const calls: string[] = [];
  const http: HttpClient = async ({ url }) => {
    calls.push(url);
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/users\/0/, "");
    if (p === "/collections") return ok([]);
    if (p === "/items" && u.searchParams.get("itemType") === "annotation") return ok(opts.viaFilter ? anns : []);
    if (p === "/items") return ok(opts.inItems ? [...base, ...anns] : base);
    const m = /^\/items\/(\w+)\/children$/.exec(p);
    if (m) {
      if (opts.childrenFails) return { status: 500, headers: {}, text: "", json: null };
      return ok(opts.viaChildren && m[1] === "ATTPDF01" ? anns : []);
    }
    return { status: 404, headers: {}, text: "", json: null };
  };
  return { http, calls };
}

const src = (http: HttpClient) => new LocalApiSource({ baseUrl: "http://127.0.0.1:23119", libraryPath: "users/0", http });
const keys = (list: ZoteroApiObject[]) => list.filter((e) => e.data.itemType === "annotation").map((e) => e.key).sort();

describe("lectura de anotaciones desde la API local", () => {
  it("vía 1: vienen en /items y no se hacen peticiones extra", async () => {
    const { http, calls } = server({ inItems: true });
    const raw = await src(http).fetchLibrary();
    expect(raw.annotationSource).toBe("items");
    expect(keys(raw.entities)).toEqual(["ANNOT001", "ANNOT002"]);
    expect(calls.some((c) => c.includes("itemType=annotation"))).toBe(false);
  });

  it("vía 2: se obtienen con el filtro itemType=annotation", async () => {
    const { http, calls } = server({ viaFilter: true });
    const raw = await src(http).fetchLibrary();
    expect(raw.annotationSource).toBe("itemType-filter");
    expect(keys(raw.entities)).toEqual(["ANNOT001", "ANNOT002"]);
    expect(calls.some((c) => c.includes("/children"))).toBe(false);
  });

  it("vía 3: se piden los hijos de cada adjunto que admite anotaciones", async () => {
    const { http, calls } = server({ viaChildren: true });
    const raw = await src(http).fetchLibrary();
    expect(raw.annotationSource).toBe("children");
    expect(keys(raw.entities)).toEqual(["ANNOT001", "ANNOT002"]);
    const childCalls = calls.filter((c) => c.includes("/children"));
    expect(childCalls).toHaveLength(1); // solo el PDF, no el enlace de texto
    expect(childCalls[0]).toContain("/items/ATTPDF01/children");
  });

  it("sin anotaciones por ninguna vía: lo indica y no inventa nada", async () => {
    const raw = await src(server({}).http).fetchLibrary();
    expect(raw.annotationSource).toBe("none");
    expect(keys(raw.entities)).toEqual([]);
  });

  it("si los hijos fallan, cuenta los errores y sigue cargando", async () => {
    const raw = await src(server({ childrenFails: true }).http).fetchLibrary();
    expect(raw.annotationErrors).toBe(1);
    expect(raw.entities.length).toBe(base.length);
  });

  it("el índice conserva la vía y las anotaciones quedan unidas al ítem", async () => {
    const raw = await src(server({ viaChildren: true }).http).fetchLibrary();
    const index = LibraryIndex.fromRaw(raw);
    expect(index.annotationSource).toBe("children");
    expect(index.annotationsOf("ITEMAAAA").map((a) => a.key)).toEqual(["ANNOT001", "ANNOT002"]);
  });

  it("todas las peticiones llevan las cabeceras de Zotero", async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const http: HttpClient = async (req) => {
      seen.push(req.headers);
      return ok([]);
    };
    await src(http).ping();
    expect(seen[0]?.["Zotero-Allowed-Request"]).toBe("1");
    expect(seen[0]?.["Zotero-API-Version"]).toBe("3");
  });
});

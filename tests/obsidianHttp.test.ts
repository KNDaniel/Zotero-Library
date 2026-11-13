import { beforeEach, describe, expect, it, vi } from "vitest";

// Un sustituto simple de requestUrl (vi.fn marca como fallo de la prueba los rechazos que devuelve).
let impl: (...a: unknown[]) => Promise<unknown> = async () => ({});
let calls: unknown[][] = [];
vi.mock("obsidian", () => ({
  requestUrl: (...a: unknown[]) => {
    calls.push(a);
    return impl(...a);
  },
}));

import { obsidianHttp, safeRequestLabel } from "../src/obsidianHttp";

function response(over: { json?: () => unknown; text?: () => string; size?: number } = {}) {
  const reads = { text: 0, json: 0 };
  const r = {
    status: 200,
    headers: { "Total-Results": "5", "Last-Modified-Version": "9" },
    arrayBuffer: new ArrayBuffer(over.size ?? 10),
    get text() {
      reads.text++;
      return over.text ? over.text() : "[1,2]";
    },
    get json() {
      reads.json++;
      if (over.json) return over.json();
      return [1, 2];
    },
  };
  return { r, reads };
}

describe("obsidianHttp", () => {
  beforeEach(() => {
    calls = [];
    impl = async () => ({});
  });

  it("normaliza las cabeceras y no decodifica nada hasta que se pide", async () => {
    const { r, reads } = response();
    impl = async () => r;
    const res = await obsidianHttp({ url: "http://127.0.0.1:23119/api/users/0/items", headers: { a: "b" } });
    expect(res.status).toBe(200);
    expect(res.headers["total-results"]).toBe("5");
    expect(res.headers["last-modified-version"]).toBe("9");
    expect(reads).toEqual({ text: 0, json: 0 });
    expect(calls[0]).toEqual([{ url: "http://127.0.0.1:23119/api/users/0/items", headers: { a: "b" }, throw: false }]);
  });

  it("si solo se usa el JSON, el texto no se decodifica (y viceversa)", async () => {
    const a = response();
    impl = async () => a.r;
    const res = await obsidianHttp({ url: "http://x/api/items" });
    expect(res.json).toEqual([1, 2]);
    expect(a.reads).toEqual({ text: 0, json: 1 });

    const b = response();
    impl = async () => b.r;
    const res2 = await obsidianHttp({ url: "http://x/api/items" });
    expect(res2.text).toBe("[1,2]");
    expect(b.reads).toEqual({ text: 1, json: 0 });
  });

  it("cada cuerpo se lee una sola vez aunque se consulte varias", async () => {
    const { r, reads } = response();
    impl = async () => r;
    const res = await obsidianHttp({ url: "http://x/api/items" });
    void res.json;
    void res.json;
    void res.text;
    void res.text;
    expect(reads).toEqual({ text: 1, json: 1 });
  });

  it("un cuerpo que no es JSON da null en vez de lanzar", async () => {
    const { r } = response({
      json: () => {
        throw new SyntaxError("no es JSON");
      },
    });
    impl = async () => r;
    const res = await obsidianHttp({ url: "http://x/api/items" });
    expect(res.json).toBeNull();
  });

  it("los errores de red se propagan para que el plugin pruebe la vía alternativa", async () => {
    impl = async () => {
      throw new Error("net::ERR_EMPTY_RESPONSE");
    };
    const err = await obsidianHttp({ url: "http://x/api/items" }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toContain("ERR_EMPTY_RESPONSE");
  });
});

describe("etiquetas HTTP para el registro", () => {
  it("omite query strings y redacta claves y biblioteca", () => {
    const label = safeRequestLabel("http://127.0.0.1:23119/api/groups/123456/items/ABCDEFGH?itemKey=ABCDEFGH&token=secret");
    expect(label).toBe("/api/[library]/items/[key]");
    expect(label).not.toContain("secret");
    expect(label).not.toContain("ABCDEFGH");
    expect(safeRequestLabel("no es URL")).toBe("[URL inválida]");
  });
});

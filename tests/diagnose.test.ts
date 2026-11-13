import * as http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nodeHttp } from "../src/nodeHttp";
import { diagnoseConnection, renderDiagnosis, type Transport } from "../src/source/diagnose";
import type { HttpClient } from "../src/source/http";
import { withFallback } from "../src/source/resilient";

const res = (status: number) => ({ status, headers: {}, text: "", json: null });

type Behaviour = number | string; // número = estado HTTP; texto = mensaje de error de red

/** Cliente falso: el comportamiento depende del host y del tipo de endpoint. */
function fake(map: Record<string, { ping: Behaviour; api: Behaviour }>): HttpClient {
  return async ({ url }) => {
    const u = new URL(url);
    const cfg = map[u.hostname];
    const v = !cfg ? "net::ERR_CONNECTION_REFUSED" : u.pathname.endsWith("/connector/ping") ? cfg.ping : cfg.api;
    if (typeof v === "string") throw new Error(v);
    return res(v);
  };
}

const T = (name: string, c: HttpClient): Transport => ({ name, http: c });
const same = (c: HttpClient): Transport[] => [T("requestUrl de Obsidian", c), T("Node http", c)];

describe("diagnóstico de conexión", () => {
  it("conexión rechazada en todo: nada escucha", async () => {
    const d = await diagnoseConnection(same(fake({})), "http://127.0.0.1:23119", "users/0");
    expect(d.verdict).toContain("Nada escucha");
  });

  it("respuesta vacía: algo escucha pero no contesta (tu caso)", async () => {
    const e = "net::ERR_EMPTY_RESPONSE";
    const c = fake({ "127.0.0.1": { ping: e, api: e }, localhost: { ping: e, api: e } });
    const d = await diagnoseConnection(same(c), "http://127.0.0.1:23119", "users/0");
    expect(d.verdict).toContain("Algo escucha");
    expect(d.verdict).not.toContain("Nada escucha");
    expect(d.verdict).toContain("netstat");
    expect(renderDiagnosis(d)).toContain("ERR_EMPTY_RESPONSE");
  });

  it("API local desactivada (403)", async () => {
    const c = fake({ "127.0.0.1": { ping: 200, api: 403 }, localhost: { ping: 200, api: 403 } });
    const d = await diagnoseConnection(same(c), "http://127.0.0.1:23119", "users/0");
    expect(d.verdict).toContain("API local está desactivada");
  });

  it("funciona solo con Node http: lo indica y el plugin lo usará", async () => {
    const bad = fake({ "127.0.0.1": { ping: "net::ERR_EMPTY_RESPONSE", api: "net::ERR_EMPTY_RESPONSE" } });
    const good = fake({ "127.0.0.1": { ping: 200, api: 200 } });
    const d = await diagnoseConnection([T("requestUrl de Obsidian", bad), T("Node http", good)], "http://127.0.0.1:23119", "users/0");
    expect(d.workingTransport).toBe("Node http");
    expect(d.verdict).toContain("automáticamente");
  });

  it("funciona con 127.0.0.1 y no con localhost", async () => {
    const d = await diagnoseConnection(same(fake({ "127.0.0.1": { ping: 200, api: 200 } })), "http://localhost:23119", "users/0");
    expect(d.workingBaseUrl).toBe("http://127.0.0.1:23119");
    expect(d.verdict).toContain("Cambia la URL");
  });

  it("404 sugiere Zotero 7; URL inválida se detecta", async () => {
    const d = await diagnoseConnection(same(fake({ "127.0.0.1": { ping: 200, api: 404 } })), "http://127.0.0.1:23119", "users/0");
    expect(d.verdict).toContain("Zotero 7");
    expect((await diagnoseConnection(same(fake({})), "no es url", "users/0")).verdict).toContain("no es válida");
  });
});

describe("withFallback", () => {
  it("usa la alternativa cuando la principal falla por red", async () => {
    const c = withFallback(
      async () => {
        throw new Error("net::ERR_EMPTY_RESPONSE");
      },
      async () => res(200),
    );
    expect((await c({ url: "http://x" })).status).toBe(200);
  });

  it("si fallan las dos, el error recoge ambos mensajes", async () => {
    const boom = (m: string): HttpClient => async () => {
      throw new Error(m);
    };
    const e = await withFallback(boom("uno"), boom("dos"))({ url: "http://x" }).catch((x) => x);
    expect(e.message).toContain("uno");
    expect(e.message).toContain("dos");
  });
});

describe("nodeHttp contra un servidor real", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, resp) => {
      if (req.url?.startsWith("/vacio")) return void req.socket.destroy(); // cierra sin responder
      resp.setHeader("Total-Results", "2");
      resp.setHeader("Content-Type", "application/json");
      resp.end(JSON.stringify({ visto: req.headers["zotero-api-version"] ?? null }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("devuelve estado, cabeceras en minúsculas y JSON", async () => {
    const r = await nodeHttp({ url: `${base}/ok`, headers: { "Zotero-API-Version": "3" } });
    expect(r.status).toBe(200);
    expect(r.headers["total-results"]).toBe("2");
    expect(r.json).toEqual({ visto: "3" });
  });

  it("una conexión cerrada sin respuesta falla con error de red", async () => {
    await expect(nodeHttp({ url: `${base}/vacio` })).rejects.toThrow(/socket hang up|ECONNRESET/i);
  });

  it("un puerto cerrado falla con ECONNREFUSED", async () => {
    await expect(nodeHttp({ url: "http://127.0.0.1:1/" })).rejects.toThrow(/ECONNREFUSED/);
  });
});

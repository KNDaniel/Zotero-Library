import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import type { HttpClient } from "../src/source/http";
import { LocalApiSource } from "../src/source/LocalApiSource";
import { renderReport, runVerification, type FsLike } from "../src/verify/verify";
import { createNodeFs } from "../src/verify/nodeFs";
import { annotation, attachment, item } from "./fixtures";

/** Anotaciones con las posiciones que producen los nombres esperados en tu nota. */
function library(positions: { first: unknown; second: unknown }) {
  return LibraryIndex.fromRaw({
    entities: [
      item("ITEMAAAA", {}, { parsedDate: "2010-06" }),
      attachment("ATTACH01", "ITEMAAAA"),
      annotation("ANN00001", "ATTACH01", {
        annotationType: "image",
        annotationPosition: JSON.stringify(positions.first),
        annotationText: "con <i>cursiva</i>",
      }),
      annotation("ANN00002", "ATTACH01", {
        annotationType: "image",
        annotationPageLabel: "5",
        annotationPosition: JSON.stringify(positions.second),
      }),
    ],
    collections: [],
    libraryVersion: 3,
    total: 4,
    truncated: false,
  });
}

const ok = { first: { pageIndex: 7, rects: [[98, 661.9, 481.2, 696.9]] }, second: { pageIndex: 48, rects: [[138.929, 629.643, 437.571, 701.357]] } };

const http: HttpClient = async ({ url }) => {
  const u = new URL(url);
  const headers = { "total-results": "2", "last-modified-version": "3", "zotero-api-version": "3" };
  if (u.pathname.endsWith("/itemFields")) return { status: 404, headers: {}, text: "", json: null };
  if (u.searchParams.get("format") === "bib") {
    const style = u.searchParams.get("style");
    return style === "apa"
      ? { status: 200, headers, text: "<div class='csl-bib-body'>Example Author (2020). Synthetic Reference.</div>", json: null }
      : { status: 404, headers, text: "", json: null };
  }
  if (u.searchParams.get("include") === "bib") return { status: 200, headers, text: "{}", json: { bib: "<div>x</div>" } };
  return { status: 200, headers, text: "[]", json: [] };
};

const fsWith = (existing: string[]): FsLike => ({
  exists: async (p) => existing.includes(p),
  readdir: async () => ["library"],
});

const source = new LocalApiSource({ baseUrl: "http://localhost:23119", libraryPath: "users/0", http });

describe("informe de verificación", () => {
  it("encuentra la regla de nombres que reproduce la nota de referencia", async () => {
    const checks = await runVerification({
      source,
      index: library(ok),
      fs: fsWith(["/z", "/z/storage"]),
      dataDir: "/z",
    });
    const names = checks.find((c) => c.id === "image-names")!;
    expect(names.status).toBe("ok");
    expect(names.details.join("\n")).toContain("p+1|x1|y1|round");
  });

  it("marca fallo si ninguna regla reproduce los nombres", async () => {
    const bad = { first: ok.first, second: { pageIndex: 3, rects: [[1, 2, 3, 4]] } };
    const checks = await runVerification({ source, index: library(bad), fs: fsWith(["/z"]), dataDir: "/z" });
    expect(checks.find((c) => c.id === "image-names")!.status).toBe("fail");
  });

  it("detecta HTML, bibliografía y ausencia de /itemFields", async () => {
    const checks = await runVerification({ source, index: library(ok), fs: fsWith(["/z", "/z/storage"]), dataDir: "/z" });
    const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
    expect(byId.html.details.join("\n")).toContain("en el texto subrayado: 1");
    expect(byId.bibliography.status).toBe("ok");
    expect(byId.bibliography.details.join("\n")).toContain("iso690-author-date-es");
    expect(byId.fields.details.join("\n")).toContain("no está disponible");
    expect(byId["bulk-annotations"].status).toBe("ok");
  });

  it("falla con claridad si la carpeta de datos no existe", async () => {
    const checks = await runVerification({ source, index: library(ok), fs: fsWith([]), dataDir: "/nada" });
    expect(checks.find((c) => c.id === "files")!.status).toBe("fail");
  });

  it("no consulta rutas relativas de datos de Zotero en el sistema de archivos", async () => {
    const requests: string[] = [];
    const checks = await runVerification({
      source,
      index: library(ok),
      fs: { exists: async (path) => { requests.push(path); return false; }, readdir: async () => [] },
      dataDir: "relative/Zotero",
    });
    const files = checks.find((c) => c.id === "files")!;
    expect(files.status).toBe("warn");
    expect(files.details.join("\n")).toContain("No se consultó el sistema de archivos");
    expect(requests).toEqual([]);
  });

  it("no consulta rutas de adjuntos con traversal en metadatos de Zotero", async () => {
    const raw = library(ok).toRaw();
    raw.entities.push(attachment("ATTACH02", "ITEMAAAA", { filename: "../outside.pdf" }));
    const requests: string[] = [];
    const checks = await runVerification({
      source,
      index: LibraryIndex.fromRaw(raw),
      fs: {
        exists: async (path) => { requests.push(path); return ["/z", "/z/storage"].includes(path); },
        readdir: async () => [],
      },
      dataDir: "/z",
    });
    expect(requests).not.toContain("/z/storage/ATTACH02/../outside.pdf");
    expect(checks.find((c) => c.id === "files")!.details.join("\n")).toContain("rutas de adjuntos con componentes no válidos");
  });

  it("distingue un error al leer cache/ de una carpeta vacía", async () => {
    const fs = createNodeFs(
      async (path) => {
        if (["/z", "/z/storage", "/z/cache"].includes(path)) return undefined;
        throw new Error("ENOENT: no existe");
      },
      async (path) => {
        if (path === "/z/cache") throw new Error("EACCES: acceso denegado");
        return [];
      },
    );
    const checks = await runVerification({ source, index: library(ok), fs, dataDir: "/z" });
    const files = checks.find((c) => c.id === "files")!;
    expect(files.status).toBe("fail");
    expect(files.details.join("\n")).toContain("EACCES: acceso denegado");
    expect(files.details.join("\n")).not.toContain("Contenido de cache/: (vacío)");
  });

  it("informa una carpeta cache/ vacía sin marcarla como error de lectura", async () => {
    const fs = createNodeFs(
      async (path) => {
        if (["/z", "/z/storage", "/z/cache"].includes(path)) return undefined;
        throw new Error("ENOENT: no existe");
      },
      async () => [],
    );
    const checks = await runVerification({ source, index: library(ok), fs, dataDir: "/z" });
    const files = checks.find((c) => c.id === "files")!;
    expect(files.details.join("\n")).toContain("Contenido de cache/: (vacío)");
    expect(files.details.join("\n")).not.toContain("Error:");
  });

  it("limita el adaptador de diagnóstico a la raíz real y rechaza una ruta enlazada fuera de ella", async () => {
    const accessed: string[] = [];
    const listed: string[] = [];
    const fs = createNodeFs(
      async (path) => { accessed.push(path); },
      async (path) => { listed.push(path); return []; },
      async (path) => path === "/z" ? "/real/z" : path === "/z/cache" ? "/outside" : `/real${path}`,
      "/z",
    );
    expect(await fs.exists("/z/cache")).toBe(false);
    await expect(fs.readdir("/z/cache")).rejects.toThrow("fuera de la carpeta");
    expect(accessed).toEqual([]);
    expect(listed).toEqual([]);
  });

  it("limita a ocho las comprobaciones concurrentes de PNG y conserva los recuentos", async () => {
    const imageCount = 24;
    const index = LibraryIndex.fromRaw({
      entities: [
        item("ITEMAAAA"),
        attachment("ATTAAAAA", "ITEMAAAA"),
        ...Array.from({ length: imageCount }, (_, i) => annotation(`IM${String(i).padStart(6, "0")}`, "ATTAAAAA", { annotationType: "image" })),
      ],
      collections: [],
      libraryVersion: 1,
      total: imageCount + 2,
      truncated: false,
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const fs: FsLike = {
      exists: async (p) => {
        if (p.endsWith(".png")) {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 1));
          inFlight--;
          return false;
        }
        return ["/z", "/z/storage", "/z/cache"].includes(p);
      },
      readdir: async () => ["library"],
    };
    const checks = await runVerification({ source, index, fs, dataDir: "/z" });
    const files = checks.find((c) => c.id === "files")!;
    expect(maxInFlight).toBe(8);
    expect(files.details.join("\n")).toContain(`Imágenes de anotaciones con PNG en la caché de Zotero: 0 de ${imageCount}.`);
  });

  it("propaga un fallo en un sondeo de PNG al resultado de la comprobación", async () => {
    let pngCalls = 0;
    const fs: FsLike = {
      exists: async (p) => {
        if (p.endsWith(".png")) {
          pngCalls++;
          if (pngCalls > 2) throw new Error("EACCES synthetic image cache");
          return false;
        }
        return ["/z", "/z/storage", "/z/cache"].includes(p);
      },
      readdir: async () => ["library"],
    };
    const checks = await runVerification({ source, index: library(ok), fs, dataDir: "/z" });
    const files = checks.find((c) => c.id === "files")!;
    expect(files.status).toBe("fail");
    expect(files.details.join("\n")).toContain("EACCES synthetic image cache");
  });

  it("con Zotero cerrado no hay una cascada de errores: un solo aviso y el resto se omite", async () => {
    const down = new LocalApiSource({
      baseUrl: "http://localhost:23119",
      libraryPath: "users/0",
      http: async () => {
        throw new Error("net::ERR_CONNECTION_REFUSED");
      },
    });
    const checks = await runVerification({ source: down, index: library(ok), fs: fsWith(["/z"]), dataDir: "/z" });
    expect(checks.filter((c) => c.status === "fail").map((c) => c.id)).not.toContain("connection");
    expect(checks[0].id).toBe("offline");
    expect(checks[0].status).toBe("info");
    const conn = checks.find((c) => c.id === "connection")!;
    expect(conn.status).toBe("info");
    expect(conn.details.join("\n")).toContain("no está abierto");
    expect(conn.details.join("\n")).toContain("Cargado:"); // lo que sí se sabe de la copia en disco
    // las comprobaciones que solo usan los datos locales siguen ahí
    expect(checks.find((c) => c.id === "files")).toBeDefined();
    expect(checks.length).toBeGreaterThan(8);
    expect(checks.every((c) => !c.details.join("").includes("ECONNREFUSED"))).toBe(true);
  });

  it("un error de red que no es «Zotero cerrado» sigue siendo un fallo (p. ej. la API desactivada)", async () => {
    const off = new LocalApiSource({
      baseUrl: "http://localhost:23119",
      libraryPath: "users/0",
      http: async () => {
        throw new Error("net::ERR_EMPTY_RESPONSE");
      },
    });
    const checks = await runVerification({ source: off, index: library(ok), fs: fsWith(["/z"]), dataDir: "/z" });
    expect(checks.find((c) => c.id === "connection")!.status).toBe("fail");
    expect(checks.some((c) => c.id === "offline")).toBe(false);
    expect(checks.length).toBeGreaterThan(8);
  });

  it("genera el informe en Markdown", async () => {
    const checks = await runVerification({ source, index: library(ok), fs: fsWith(["/z"]), dataDir: "/z" });
    const md = renderReport(checks, { date: "2026-10-31", pluginVersion: "0.1.0" });
    expect(md).toContain("# Zotero Library — informe de verificación");
    expect(md).toMatch(/## (✅|⚠️|❌|ℹ️) Conexión con la API local/);
  });
});

describe("informe: sincronización incremental", () => {
  const mk = (opts: { respectSince: boolean; deleted: boolean }): HttpClient => async ({ url }) => {
    const u = new URL(url);
    const headers: Record<string, string> = { "last-modified-version": "500" };
    if (u.pathname.endsWith("/deleted")) return opts.deleted ? { status: 200, headers, text: "", json: { items: ["A1B2C3D4"], collections: [] } } : { status: 404, headers, text: "", json: null };
    const since = Number(u.searchParams.get("since") ?? -1);
    if (u.pathname.endsWith("/items") && u.searchParams.has("since")) {
      const n = opts.respectSince ? (since >= 500 ? 0 : 3) : 4;
      return { status: 200, headers: { ...headers, "total-results": String(n) }, text: "", json: [] };
    }
    return { status: 200, headers: { ...headers, "total-results": "2", "zotero-api-version": "3" }, text: "[]", json: [] };
  };
  const run = async (opts: { respectSince: boolean; deleted: boolean }) => {
    const idx = library(ok);
    idx.libraryVersion = 500;
    const src = new LocalApiSource({ baseUrl: "http://localhost:23119", libraryPath: "users/0", http: mk(opts) });
    const checks = await runVerification({ source: src, index: idx, fs: fsWith(["/z"]), dataDir: "/z" });
    return checks.find((c) => c.id === "sync")!;
  };
  it("ok cuando since se respeta y /deleted funciona", async () => {
    const c = await run({ respectSince: true, deleted: true });
    expect(c.status).toBe("ok");
    expect(c.details.join("\n")).toContain("funciona (items: 1)");
  });
  it("avisa si la API ignora since", async () => {
    const c = await run({ respectSince: false, deleted: true });
    expect(c.status).toBe("warn");
    expect(c.details.join("\n")).toContain("ignorar `since`");
  });
  it("avisa si falta /deleted: se recargará todo", async () => {
    const c = await run({ respectSince: true, deleted: false });
    expect(c.status).toBe("warn");
    expect(c.details.join("\n")).toContain("se recargará toda la biblioteca");
  });
});

describe("informe: sin /deleted pero con lista de claves", () => {
  it("lo da por bueno si format=keys devuelve casi todas las claves", async () => {
    const idx = library(ok);
    idx.libraryVersion = 500;
    const total = idx.stats().items + idx.stats().attachments + idx.stats().notes + idx.stats().annotations;
    const keysText = Array.from({ length: total }, (_, i) => `K${String(i).padStart(7, "0")}`).join("\n");
    const http: HttpClient = async ({ url }) => {
      const u = new URL(url);
      const headers = { "last-modified-version": "500" };
      if (u.pathname.endsWith("/deleted")) return { status: 404, headers, text: "", json: null };
      if (u.searchParams.get("format") === "keys") return { status: 200, headers, text: keysText, json: null };
      if (u.searchParams.has("since")) return { status: 200, headers: { ...headers, "total-results": "0" }, text: "", json: [] };
      return { status: 200, headers: { ...headers, "total-results": "2" }, text: "[]", json: [] };
    };
    const src = new LocalApiSource({ baseUrl: "http://localhost:23119", libraryPath: "users/0", http });
    const c = (await runVerification({ source: src, index: idx, fs: fsWith(["/z"]), dataDir: "/z" })).find((x) => x.id === "sync")!;
    expect(c.status).toBe("ok");
    expect(c.details.join("\n")).toContain("comparando la lista de claves");
  });
});

describe("informe: métricas de sesión y de descarga", () => {
  const connection = async (idx: LibraryIndex, session?: Parameters<typeof runVerification>[0]["session"]) =>
    (await runVerification({ source, index: idx, fs: fsWith(["/z"]), dataDir: "/z", session })).find((c) => c.id === "connection")!.details.join("\n");

  it("separa lo de esta sesión (copia en disco) de lo de la última descarga completa", async () => {
    const idx = library(ok);
    idx.fetchedAt = Date.UTC(2026, 10, 1, 12, 0);
    idx.fetchMs = 41_000;
    idx.fetchMode = "unpaged";
    idx.requests = 2;
    const text = await connection(idx, { origin: "cache", ms: 812, cacheSavedAt: Date.UTC(2026, 10, 5, 9, 0), lastSync: { status: "incremental", ms: 230, at: Date.UTC(2026, 10, 6, 9, 0) } });
    expect(text).toContain("Esta sesión: biblioteca abierta desde la copia en disco");
    expect(text).toContain("en 812 ms");
    expect(text).toContain("incremental (solo lo modificado), 230 ms");
    expect(text).toContain("Última descarga completa");
    expect(text).toContain("41000 ms; en una sola respuesta, 2 peticiones");
    expect(text).not.toContain("Tiempo de carga"); // ya no mezcla ambas cosas
  });

  it("descarga completa en esta sesión", async () => {
    const text = await connection(library(ok), { origin: "download", ms: 52_000 });
    expect(text).toContain("Esta sesión: descarga completa desde Zotero en 52000 ms");
    expect(text).toContain("todavía no se ha sincronizado");
  });

  it("una copia anterior a la 0.6.1 lo dice en vez de enseñar 0 ms", async () => {
    const idx = library(ok);
    idx.fetchMode = "unpaged";
    idx.requests = 2;
    const text = await connection(idx, { origin: "cache", ms: 700 });
    expect(text).toContain("fecha y duración no registradas");
    expect(text).toContain("2 peticiones");
    expect(text).not.toMatch(/\b0 ms\b/);
  });

  it("sin información de sesión no inventa tiempos", async () => {
    const text = await connection(library(ok));
    expect(text).toContain("no hay registro de cómo se cargó");
  });
});

describe("informe: origen de los colores no estándar", () => {
  const build = (extra: ReturnType<typeof annotation>[], attachments: ReturnType<typeof attachment>[] = []) =>
    LibraryIndex.fromRaw({
      entities: [item("ITEMAAAA", { title: "Obra A" }), attachment("ATTAAAAA", "ITEMAAAA", { filename: "a.pdf" }), ...attachments, annotation("ANNSTD01", "ATTAAAAA"), ...extra],
      collections: [],
      libraryVersion: 1,
      total: 4,
      truncated: false,
    });
  const run = async (idx: LibraryIndex) => (await runVerification({ source, index: idx, fs: fsWith(["/z"]), dataDir: "/z" })).find((c) => c.id === "colors-origin")!;

  it("sin colores raros dice que todo es estándar", async () => {
    const c = await run(build([]));
    expect(c.status).toBe("ok");
    expect(c.details.join("\n")).toContain("ocho colores estándar");
  });

  it("muestra por color: tipo de PDF, autor, fechas y adjuntos implicados", async () => {
    const idx = build(
      [
        annotation("ANNODD01", "ATTAAAAA", { annotationColor: "#8df0fd", annotationAuthorName: "Otro programa", dateAdded: "2023-03-04T00:00:00Z" }),
        annotation("ANNODD02", "ATTAAAAA", { annotationColor: "#8df0fd", annotationAuthorName: "Otro programa", dateAdded: "2023-05-06T00:00:00Z" }),
        annotation("ANNODD03", "SUELTO01", { annotationColor: "#339e00" }),
      ],
      [attachment("SUELTO01", null, { filename: "suelto.pdf" })],
    );
    const c = await run(idx);
    expect(c.status).toBe("warn");
    const text = c.details.join("\n");
    expect(text).toContain("Anotaciones con color no estándar: 3 de 4");
    expect(text).toContain("`#8df0fd` (2");
    expect(text).toContain("en PDF de un ítem: 2, en PDF suelto: 0");
    expect(text).toContain("`Otro programa`: 2");
    expect(text).toContain("2023-03-04 → 2023-05-06");
    expect(text).toContain("con anotaciones de color estándar también: 1"); // ATTAAAAA tiene ANNSTD01
    expect(text).toContain("`#339e00` (1");
    expect(text).toContain("en PDF suelto: 1");
    expect(text).toContain("(PDF suelto)");
    expect(text).toContain("Obra A");
  });

  it("el informe en Markdown anida las líneas de detalle", async () => {
    const idx = build([annotation("ANNODD01", "ATTAAAAA", { annotationColor: "#8df0fd" })]);
    const checks = await runVerification({ source, index: idx, fs: fsWith(["/z"]), dataDir: "/z" });
    const md = renderReport(checks, { date: "hoy", pluginVersion: "0.6.1" });
    expect(md).toContain("Origen de los colores no estándar");
    expect(md).toMatch(/\n {2}- `#8df0fd` en `a\.pdf`/);
  });
});

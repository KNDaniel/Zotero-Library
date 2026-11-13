import type { ZoteroApiObject } from "../model/types";
import { ZoteroConnectionError, type HttpClient, type HttpResponse } from "./http";
import { bibHtmlToEntries } from "../output/bibliography";
import type { AnnotationSource, Changes, PingResult, ProgressCallback, RawLibrary, ZoteroSource } from "./ZoteroSource";

export interface LocalApiOptions {
  /** p. ej. http://localhost:23119 */
  baseUrl: string;
  /** users/0 para la biblioteca personal, groups/<id> para un grupo */
  libraryPath: string;
  http: HttpClient;
  pageSize?: number;
  concurrency?: number;
}

type Query = Record<string, string | number | undefined>;

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, "");
const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Zotero rechaza las peticiones que parecen venir de una página web salvo que
 * lleven esta cabecera (la usan, por ejemplo, otras apps Electron).
 */
export const ZOTERO_HEADERS: Record<string, string> = {
  "Zotero-API-Version": "3",
  "Zotero-Allowed-Request": "1",
};

const ANNOTATABLE = /^(application\/pdf|application\/epub\+zip|text\/html)/i;
const isAnnotation = (e: ZoteroApiObject) => e?.data?.itemType === "annotation";

export const CONNECTION_HINT =
  "Comprueba que Zotero está abierto y que, en Zotero > Ajustes > Avanzado, está activada la opción " +
  "«Permitir que otras aplicaciones de este equipo se comuniquen con Zotero».";

export class LocalApiSource implements ZoteroSource {
  readonly apiRoot: string;
  readonly libraryRoot: string;
  private readonly http: HttpClient;
  private readonly pageSize: number;
  private readonly concurrency: number;
  /** null = aún no se sabe si la API entrega todo sin paginar */
  private unpaged: boolean | null = null;
  requests = 0;

  constructor(opts: LocalApiOptions) {
    this.apiRoot = `${opts.baseUrl.replace(/\/+$/, "")}/api`;
    this.libraryRoot = `${this.apiRoot}/${trimSlashes(opts.libraryPath)}`;
    this.http = opts.http;
    this.pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
    this.concurrency = Math.max(opts.concurrency ?? 4, 1);
  }

  private buildUrl(root: string, path: string, query: Query): string {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${root}${p}${qs ? `?${qs}` : ""}`;
  }

  /** Petición cruda a la biblioteca (o a la raíz de la API con `root: "api"`). */
  async get(path: string, query: Query = {}, root: "library" | "api" = "library"): Promise<HttpResponse> {
    const url = this.buildUrl(root === "library" ? this.libraryRoot : this.apiRoot, path, query);
    this.requests++;
    try {
      return await this.http({ url, headers: ZOTERO_HEADERS });
    } catch (e) {
      throw new ZoteroConnectionError(
        `No se pudo conectar con Zotero (${(e as Error)?.message ?? "error de red"})`,
        CONNECTION_HINT,
      );
    }
  }

  /** Como `get`, pero lanza un error con pista si la respuesta no es 2xx. */
  async getOk(path: string, query: Query = {}, root: "library" | "api" = "library"): Promise<HttpResponse> {
    const res = await this.get(path, query, root);
    if (res.status >= 200 && res.status < 300) return res;
    if (res.status === 403) {
      throw new ZoteroConnectionError("Zotero rechazó la petición (403)", CONNECTION_HINT, 403);
    }
    if (res.status === 404) {
      throw new ZoteroConnectionError(
        `No se encontró ${path} (404)`,
        "Revisa la ruta de la biblioteca en los ajustes (users/0 para la personal, groups/<id> para un grupo).",
        404,
      );
    }
    throw new ZoteroConnectionError(`Zotero respondió con el estado ${res.status}`, "", res.status);
  }

  async ping(): Promise<PingResult> {
    const res = await this.getOk("/items", { limit: 1 });
    return {
      total: num(res.headers["total-results"]) ?? 0,
      libraryVersion: num(res.headers["last-modified-version"]) ?? 0,
      apiVersion: res.headers["zotero-api-version"],
    };
  }

  private asArray(res: HttpResponse): ZoteroApiObject[] {
    if (!Array.isArray(res.json)) {
      throw new ZoteroConnectionError("Respuesta inesperada de Zotero (se esperaba una lista)", CONNECTION_HINT, res.status);
    }
    return res.json as ZoteroApiObject[];
  }

  /**
   * Descarga un listado completo. La API local, a diferencia de la web, no
   * pagina por defecto: se intenta primero una sola petición (mucho más rápida
   * en bibliotecas grandes) y, si el servidor devuelve menos de lo anunciado,
   * se pagina con el tamaño de página que el servidor realmente respeta.
   */
  async getPaged(
    path: string,
    query: Query = {},
    onProgress?: ProgressCallback,
  ): Promise<{ data: ZoteroApiObject[]; total: number; libraryVersion: number; truncated: boolean; mode: "unpaged" | "paged" }> {
    if (this.unpaged !== false) {
      const res = await this.getOk(path, query);
      const data = this.asArray(res);
      const total = num(res.headers["total-results"]);
      const libraryVersion = num(res.headers["last-modified-version"]) ?? 0;
      if (total !== undefined && data.length >= total) {
        this.unpaged = true;
        onProgress?.(data.length, total);
        return { data, total, libraryVersion, truncated: false, mode: "unpaged" };
      }
      this.unpaged = false; // el servidor pagina por defecto (o no informa del total)
    }

    const limit = this.pageSize;
    const first = await this.getOk(path, { ...query, limit, start: 0 });
    const firstData = this.asArray(first);
    const libraryVersion = num(first.headers["last-modified-version"]) ?? 0;
    const totalHeader = num(first.headers["total-results"]);
    const data: ZoteroApiObject[] = [...firstData];

    if (totalHeader === undefined) {
      // Sin Total-Results: seguir hasta que una página venga incompleta.
      let last = firstData;
      let start = firstData.length;
      while (last.length === limit) {
        last = this.asArray(await this.getOk(path, { ...query, limit, start }));
        data.push(...last);
        start += limit;
        onProgress?.(data.length, data.length);
      }
      return { data, total: data.length, libraryVersion, truncated: false, mode: "paged" };
    }

    onProgress?.(data.length, totalHeader);
    // Si el servidor devuelve páginas más cortas que `limit`, avanzar de ese tamaño.
    const step = firstData.length < Math.min(limit, totalHeader) ? firstData.length : limit;
    if (step === 0) return { data, total: totalHeader, libraryVersion, truncated: totalHeader > 0, mode: "paged" };
    const starts: number[] = [];
    for (let s = step; s < totalHeader; s += step) starts.push(s);
    for (let i = 0; i < starts.length; i += this.concurrency) {
      const chunk = starts.slice(i, i + this.concurrency);
      const pages = await Promise.all(
        chunk.map(async (start) => this.asArray(await this.getOk(path, { ...query, limit, start }))),
      );
      for (const page of pages) data.push(...page);
      onProgress?.(Math.min(data.length, totalHeader), totalHeader);
    }
    return { data, total: totalHeader, libraryVersion, truncated: data.length < totalHeader, mode: "paged" };
  }

  async fetchLibrary(onProgress?: ProgressCallback): Promise<RawLibrary> {
    // /items devuelve los ítems y sus hijos (adjuntos y notas). Las anotaciones
    // pueden venir o no según la versión de Zotero, así que hay tres vías.
    this.requests = 0;
    const startedAt = Date.now();
    const items = await this.getPaged("/items", {}, onProgress);
    const byKey = new Map<string, ZoteroApiObject>();
    for (const e of items.data) byKey.set(e.key, e);

    let annotationSource: AnnotationSource = "items";
    let annotationErrors = 0;

    if (![...byKey.values()].some(isAnnotation)) {
      annotationSource = "none";

      // Vía B: filtrar por tipo de ítem.
      try {
        const filtered = await this.getPaged("/items", { itemType: "annotation" });
        for (const e of filtered.data.filter(isAnnotation)) byKey.set(e.key, e);
        if (filtered.data.some(isAnnotation)) annotationSource = "itemType-filter";
      } catch {
        // se prueba la siguiente vía
      }

      // Vía C: pedir los hijos de cada adjunto que admite anotaciones.
      if (annotationSource === "none") {
        const attachments = [...byKey.values()].filter(
          (e) => e.data?.itemType === "attachment" && ANNOTATABLE.test(String(e.data.contentType ?? "")),
        );
        let done = 0;
        for (let i = 0; i < attachments.length; i += this.concurrency) {
          const chunk = attachments.slice(i, i + this.concurrency);
          await Promise.all(
            chunk.map(async (a) => {
              try {
                const children = await this.getPaged(`/items/${a.key}/children`);
                for (const e of children.data.filter(isAnnotation)) byKey.set(e.key, e);
              } catch {
                annotationErrors++;
              }
            }),
          );
          done += chunk.length;
          onProgress?.(done, attachments.length);
        }
        if ([...byKey.values()].some(isAnnotation)) annotationSource = "children";
      }
    }

    const collections = await this.getPaged("/collections");
    return {
      entities: [...byKey.values()],
      collections: collections.data,
      libraryVersion: items.libraryVersion,
      total: items.total,
      truncated: items.truncated,
      annotationSource,
      annotationErrors,
      fetchMode: items.mode,
      requests: this.requests,
      fetchedAt: Date.now(),
      fetchMs: Date.now() - startedAt,
    };
  }

  /**
   * Claves de todos los elementos de un listado (`format=keys`). Devuelve null si
   * la API no lo soporta o la respuesta no se entiende.
   */
  async fetchKeys(path: string): Promise<Set<string> | null> {
    const res = await this.get(path, { format: "keys" });
    if (res.status < 200 || res.status >= 300) return null;
    const text = res.text.trim();
    if (text === "") return new Set();
    if (text.startsWith("[") || text.startsWith("{")) return null; // devolvió JSON: ignoró el formato
    const keys = text.match(/\b[A-Z0-9]{8}\b/g);
    return keys ? new Set(keys) : null;
  }

  /**
   * Cambios desde `since` (versión de la biblioteca). Pide también los ítems en
   * la papelera para poder retirarlos de la copia. Los borrados salen de
   * `/deleted`; si la API local no lo ofrece, se deducen comparando las claves
   * que tiene Zotero con las de la copia (`known`). Si ninguna vía funciona,
   * `deleted` es null y hay que recargar todo. Si la API ignorara `since`,
   * devolvería todo: es correcto (se mezcla por clave), solo más lento.
   */
  async fetchChanges(since: number, known?: { items: Set<string>; collections: Set<string> }): Promise<Changes> {
    const items = await this.getPaged("/items", { since, includeTrashed: 1 });
    const collections = await this.getPaged("/collections", { since });
    const res = await this.get("/deleted", { since });
    let deleted: Changes["deleted"] = null;
    if (res.status >= 200 && res.status < 300 && res.json && typeof res.json === "object") {
      const o = res.json as { items?: unknown; collections?: unknown };
      const keys = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
      deleted = { items: keys(o.items), collections: keys(o.collections) };
    } else if (known) {
      const [itemKeys, collectionKeys] = [await this.fetchKeys("/items"), await this.fetchKeys("/collections")];
      // Protección: una lista muy corta se trata como fallo, no como «se borró casi todo».
      const plausible = !!itemKeys && !!collectionKeys && (known.items.size < 20 || itemKeys.size >= known.items.size * 0.5);
      if (itemKeys && collectionKeys && plausible) {
        deleted = {
          items: [...known.items].filter((k) => !itemKeys.has(k)),
          collections: [...known.collections].filter((k) => !collectionKeys.has(k)),
        };
      }
    }
    return { changed: items.data, changedCollections: collections.data, deleted, libraryVersion: items.libraryVersion };
  }

  /**
   * Bibliografía formateada por Zotero con un estilo CSL. Pide los ítems por
   * lotes (`itemKey=a,b,c`, el orden lo decide el estilo) y, si la API local no
   * lo admite o devuelve un número distinto de entradas, ítem a ítem.
   */
  async fetchBibliography(
    keys: string[],
    style: string,
    chunk = 50,
  ): Promise<{ entries: string[]; failed: string[]; mode: "batch" | "single" | "mixed" }> {
    const entries: string[] = [];
    const failed: string[] = [];
    let batch = 0;
    let single = 0;
    for (let i = 0; i < keys.length; i += chunk) {
      const part = keys.slice(i, i + chunk);
      const res = await this.get("/items", { itemKey: part.join(","), format: "bib", style });
      if (res.status === 400) throw new Error(`El estilo «${style}» no está disponible en tu Zotero.`);
      if (res.status >= 200 && res.status < 300) {
        const got = bibHtmlToEntries(res.text);
        if (got.length === part.length) {
          entries.push(...got);
          batch++;
          continue;
        }
      }
      // Alternativa: uno a uno, en el orden pedido
      for (const key of part) {
        const one = await this.get(`/items/${key}`, { format: "bib", style });
        if (one.status === 400) throw new Error(`El estilo «${style}» no está disponible en tu Zotero.`);
        const got = one.status >= 200 && one.status < 300 ? bibHtmlToEntries(one.text) : [];
        if (got.length) entries.push(got[0]);
        else failed.push(key);
        single++;
      }
    }
    return { entries, failed, mode: batch && single ? "mixed" : single ? "single" : "batch" };
  }
}

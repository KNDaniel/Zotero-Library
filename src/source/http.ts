/** Capa HTTP mínima, inyectable para poder probar sin Zotero ni Obsidian. */
export interface HttpResponse {
  status: number;
  /** Nombres de cabecera en minúsculas */
  headers: Record<string, string>;
  text: string;
  json: unknown;
}

export type HttpClient = (req: { url: string; headers?: Record<string, string> }) => Promise<HttpResponse>;

export class ZoteroConnectionError extends Error {
  constructor(
    message: string,
    public readonly hint: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ZoteroConnectionError";
  }
}

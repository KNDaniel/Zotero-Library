import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const MAX_BYTES = 400 * 1024;

/**
 * Registro de diagnóstico en un archivo de la carpeta del plugin. Las líneas se
 * escriben de forma SÍNCRONA: si algo se cuelga después, lo anterior queda en
 * disco y se puede ver hasta dónde llegó el plugin.
 */
export class Tracer {
  private path: string | null = null;
  private t0 = Date.now();

  /** `basePath`: carpeta del vault en disco; `dir`: carpeta del plugin dentro del vault. */
  init(basePath: string | null | undefined, dir: string | undefined, version: string): void {
    this.t0 = Date.now();
    if (!basePath || !dir) return;
    try {
      this.path = join(basePath, dir, "zotero-library.log");
      // Si el archivo creció demasiado, se empieza de nuevo.
      if (existsSync(this.path) && statSync(this.path).size > MAX_BYTES) writeFileSync(this.path, "");
    } catch {
      this.path = null;
    }
    this.log(`=== Zotero Library ${version} · ${process.platform} · Obsidian ${typeof navigator !== "undefined" ? navigator.userAgent.match(/obsidian\/([\d.]+)/i)?.[1] ?? "?" : "?"} ===`);
  }

  get file(): string | null {
    return this.path;
  }

  log(message: string): void {
    const line = `${new Date().toISOString()} +${Date.now() - this.t0}ms ${message}`;
    console.debug("[zotero-library]", message);
    if (!this.path) return;
    try {
      appendFileSync(this.path, `${line}\n`);
    } catch {
      /* el registro nunca debe romper el plugin */
    }
  }

  error(where: string, e: unknown): void {
    const err = e as Error | undefined;
    this.log(`ERROR en ${where}: ${err?.stack ?? err?.message ?? String(e)}`);
  }

  /** Últimas líneas del registro (para mostrarlas dentro de Obsidian). */
  tail(lines = 200): string {
    if (!this.path || !existsSync(this.path)) return "(no hay registro)";
    try {
      return readFileSync(this.path, "utf8").split("\n").slice(-lines).join("\n");
    } catch {
      return "(no se pudo leer el registro)";
    }
  }
}

export const trace = new Tracer();

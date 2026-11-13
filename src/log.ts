import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { isAbsolute, relative, resolve, sep } from "path";

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
  init(basePath: string | null | undefined, dir: string | undefined, version: string, platform = process.platform): void {
    this.t0 = Date.now();
    if (!basePath || !dir) return;
    try {
      const root = resolve(basePath);
      const folder = resolve(root, dir);
      const insideVault = relative(root, folder);
      if (!insideVault || insideVault === ".." || insideVault.startsWith(`..${sep}`) || isAbsolute(insideVault)) return;
      this.path = join(folder, "zotero-library.log");
      // Si el archivo creció demasiado, se empieza de nuevo.
      if (existsSync(this.path) && statSync(this.path).size > MAX_BYTES) writeFileSync(this.path, "");
    } catch {
      this.path = null;
    }
    const platformName = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : "otro";
    this.log(`=== Zotero Library ${version} · ${platformName} · Obsidian ===`);
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
    const name = err?.name || "Error";
    const message = err?.message || String(e);
    this.log(`ERROR en ${where}: ${name}: ${redactLocalPaths(message)}`);
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

function redactLocalPaths(message: string): string {
  return message
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, "[ruta local]")
    .replace(/(?:\\\\|\/)(?:Users|home)\/[^\s"'<>]+/g, "[ruta local]")
    .replace(/https?:\/\/[^\s"'<>]+/g, "[URL]");
}

export const trace = new Tracer();

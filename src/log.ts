const MAX_BYTES = 400 * 1024;
const MAX_MEMORY_LINES = 1000;

/** Operaciones limitadas al adaptador del vault; también funciona con la carpeta oculta del plugin. */
export interface LogAdapter {
  stat(path: string): Promise<{ size: number; type: string } | null>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
}

function logPath(configDir: string, pluginId: string): string | null {
  const safeConfig = configDir.replace(/\\/g, "/").replace(/\/+$/g, "");
  const parts = safeConfig.split("/");
  if (!safeConfig || safeConfig.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) return null;
  if (!/^[a-z0-9-]+$/i.test(pluginId)) return null;
  return `${safeConfig}/plugins/${pluginId}/zotero-library.log`;
}

/** Registro acotado a la carpeta del plugin mediante el adaptador del vault. */
export class Tracer {
  private adapter: LogAdapter | null = null;
  private path: string | null = null;
  private t0 = Date.now();
  private queue: Promise<void> = Promise.resolve();
  private readonly lines: string[] = [];

  init(adapter: LogAdapter | null | undefined, configDir: string | undefined, pluginId: string, version: string, platform = process.platform): void {
    this.t0 = Date.now();
    this.queue = Promise.resolve();
    this.adapter = adapter ?? null;
    this.path = configDir ? logPath(configDir, pluginId) : null;
    if (!this.adapter || !this.path) {
      this.adapter = null;
      this.path = null;
    } else {
      const logAdapter = this.adapter;
      const path = this.path;
      this.enqueue(async () => {
        try {
          const stat = await logAdapter.stat(path);
          if (stat?.type === "file" && stat.size > MAX_BYTES) await logAdapter.write(path, "");
        } catch {
          // El diagnóstico nunca debe impedir que el plugin cargue.
        }
      });
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
    this.lines.push(line);
    if (this.lines.length > MAX_MEMORY_LINES) this.lines.splice(0, this.lines.length - MAX_MEMORY_LINES);
    const adapter = this.adapter;
    const path = this.path;
    if (!adapter || !path) return;
    this.enqueue(async () => {
      try {
        const stat = await adapter.stat(path);
        if (!stat) await adapter.write(path, `${line}\n`);
        else {
          if (stat.type !== "file") throw new Error("La ruta del registro no es un archivo.");
          if (stat.size > MAX_BYTES) await adapter.write(path, "");
          await adapter.append(path, `${line}\n`);
        }
      } catch {
        // El registro nunca debe romper el plugin.
      }
    });
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(operation, operation).catch(() => undefined);
  }

  error(where: string, error: unknown): void {
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    this.log(`ERROR en ${where}: ${name}: ${redactLocalPaths(message)}`);
  }

  /** Espera el registro del vault; si no está disponible, usa el búfer de esta sesión. */
  async tail(lines = 200): Promise<string> {
    await this.queue;
    if (this.adapter && this.path) {
      try {
        return (await this.adapter.read(this.path)).split("\n").slice(-lines).join("\n");
      } catch {
        // Se conserva el búfer en memoria para que el comando de diagnóstico siga disponible.
      }
    }
    return this.lines.slice(-lines).join("\n") || "(no hay registro)";
  }
}

function redactLocalPaths(message: string): string {
  return message
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, "[ruta local]")
    .replace(/(?:\\\\|\/)(?:Users|home)\/[^\s"'<>]+/g, "[ruta local]")
    .replace(/https?:\/\/[^\s"'<>]+/g, "[URL]");
}

export const trace = new Tracer();

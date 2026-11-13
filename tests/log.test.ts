import { describe, expect, it } from "vitest";
import { Tracer, type LogAdapter } from "../src/log";

class MemoryAdapter implements LogAdapter {
  readonly files = new Map<string, string>();
  async stat(path: string): Promise<{ size: number; type: string } | null> {
    const content = this.files.get(path);
    return content === undefined ? null : { size: new TextEncoder().encode(content).byteLength, type: "file" };
  }
  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error("missing");
    return content;
  }
  async write(path: string, data: string): Promise<void> { this.files.set(path, data); }
  async append(path: string, data: string): Promise<void> { this.files.set(path, (this.files.get(path) ?? "") + data); }
}

describe("registro de diagnóstico", () => {
  it("escribe en la ruta relativa del plugin mediante el adaptador del vault", async () => {
    const adapter = new MemoryAdapter();
    const tracer = new Tracer();
    tracer.init(adapter, ".obsidian", "zotero-library", "9.9.9");
    tracer.log("primera");
    expect(await tracer.tail()).toContain("=== Zotero Library 9.9.9");
    expect(await tracer.tail()).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z \+\d+ms primera\n/);
    expect(tracer.file).toBe(".obsidian/plugins/zotero-library/zotero-library.log");
  });

  it("registra errores y devuelve las últimas líneas", async () => {
    const adapter = new MemoryAdapter();
    const tracer = new Tracer();
    tracer.init(adapter, ".obsidian", "zotero-library", "1");
    tracer.error("abrir la vista", new Error("fallo de prueba"));
    for (let i = 0; i < 10; i++) tracer.log(`línea ${i}`);
    expect(await tracer.tail(50)).toContain("ERROR en abrir la vista: Error: fallo de prueba");
    expect((await tracer.tail(3)).split("\n")).toHaveLength(3);
    expect(await tracer.tail(3)).toContain("línea 9");
  });

  it("recorta archivos de registro mayores de 400 KB antes de continuar", async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(".obsidian/plugins/zotero-library/zotero-library.log", "x".repeat(500 * 1024));
    const tracer = new Tracer();
    tracer.init(adapter, ".obsidian", "zotero-library", "1");
    await tracer.tail();
    expect((await adapter.read(tracer.file!)).length).toBeLessThan(2000);
  });

  it("rechaza rutas de configuración o identificadores que puedan salir del vault", async () => {
    const adapter = new MemoryAdapter();
    const tracer = new Tracer();
    tracer.init(adapter, "../fuera", "zotero-library", "1");
    tracer.log("solo memoria");
    expect(tracer.file).toBeNull();
    expect(await tracer.tail()).toContain("solo memoria");
    const badId = new Tracer();
    badId.init(adapter, ".obsidian", "../otro", "1");
    expect(badId.file).toBeNull();
  });

  it("mantiene el comando de diagnóstico disponible si el adaptador falla", async () => {
    const adapter: LogAdapter = {
      stat: async () => { throw new Error("offline"); },
      read: async () => { throw new Error("offline"); },
      write: async () => { throw new Error("offline"); },
      append: async () => { throw new Error("offline"); },
    };
    const tracer = new Tracer();
    tracer.init(adapter, ".obsidian", "zotero-library", "1");
    tracer.log("memoria");
    expect(await tracer.tail()).toContain("memoria");
  });
});

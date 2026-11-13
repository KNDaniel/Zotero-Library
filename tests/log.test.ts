import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Tracer } from "../src/log";

const tmpVault = () => {
  const base = mkdtempSync(join(tmpdir(), "zl-"));
  mkdirSync(join(base, ".obsidian/plugins/zotero-library"), { recursive: true });
  return base;
};
const DIR = ".obsidian/plugins/zotero-library";

describe("registro de diagnóstico", () => {
  it("escribe cada línea en disco en el momento (síncrono), con hora y tiempo", () => {
    const base = tmpVault();
    const t = new Tracer();
    t.init(base, DIR, "9.9.9");
    t.log("primera");
    // se lee el archivo sin esperar nada: si fuera asíncrono, aún no estaría
    const text = readFileSync(join(base, DIR, "zotero-library.log"), "utf8");
    expect(text).toContain("=== Zotero Library 9.9.9");
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z \+\d+ms primera\n/);
  });

  it("registra errores con su pila y permite leer las últimas líneas", () => {
    const base = tmpVault();
    const t = new Tracer();
    t.init(base, DIR, "1");
    t.error("abrir la vista", new Error("fallo de prueba"));
    for (let i = 0; i < 10; i++) t.log(`línea ${i}`);
    expect(t.tail(50)).toContain("ERROR en abrir la vista: Error: fallo de prueba");
    expect(t.tail(3).split("\n")).toHaveLength(3);
    expect(t.tail(3)).toContain("línea 9");
    expect(t.file).toBe(join(base, DIR, "zotero-library.log"));
  });

  it("un archivo demasiado grande se reinicia", () => {
    const base = tmpVault();
    const file = join(base, DIR, "zotero-library.log");
    writeFileSync(file, "x".repeat(500 * 1024));
    const t = new Tracer();
    t.init(base, DIR, "1");
    expect(readFileSync(file, "utf8").length).toBeLessThan(2000);
  });

  it("sin carpeta no hace nada y nunca lanza errores", () => {
    const t = new Tracer();
    t.init(null, undefined, "1");
    expect(() => t.log("sin disco")).not.toThrow();
    expect(t.tail()).toBe("(no hay registro)");
    const bad = new Tracer();
    bad.init("/ruta/que/no/existe", DIR, "1");
    expect(() => bad.log("ruta inválida")).not.toThrow();
  });
});

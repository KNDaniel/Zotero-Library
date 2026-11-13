import { describe, expect, it, vi } from "vitest";
import { getElectronShell } from "../src/electronShell";

describe("adaptador de Electron shell", () => {
  it("devuelve null si require, shell o sus métodos no están disponibles", () => {
    expect(getElectronShell(undefined, {})).toBeNull();
    expect(getElectronShell(() => undefined, {})).toBeNull();
    expect(getElectronShell(() => ({ shell: { openPath: () => Promise.resolve("") } }), {})).toBeNull();
  });

  it("valida la forma y el resultado de openPath y delega showItemInFolder", async () => {
    const openPath = vi.fn(async () => "");
    const showItemInFolder = vi.fn();
    const receiver = {};
    const shell = { openPath, showItemInFolder };
    const api = getElectronShell((name: string) => name === "electron" ? { shell } : undefined, receiver);
    expect(api).not.toBeNull();
    expect(await api!.openPath("C:/Zotero/paper.pdf")).toBe("");
    api!.showItemInFolder("C:/Zotero/paper.pdf");
    expect(openPath).toHaveBeenCalledWith("C:/Zotero/paper.pdf");
    expect(showItemInFolder).toHaveBeenCalledWith("C:/Zotero/paper.pdf");
  });

  it("rechaza resultados de openPath que no sean promesas de texto", async () => {
    const immediate = getElectronShell(() => ({ shell: { openPath: () => "" , showItemInFolder: () => undefined } }), {});
    await expect(immediate!.openPath("paper.pdf")).rejects.toThrow("no devolvió una promesa válida");

    const malformed = getElectronShell(() => ({ shell: { openPath: async () => 12, showItemInFolder: () => undefined } }), {});
    await expect(malformed!.openPath("paper.pdf")).rejects.toThrow("resultado no válido");
  });

  it("convierte las excepciones de require en indisponibilidad segura", () => {
    expect(getElectronShell(() => { throw new Error("no disponible"); }, {})).toBeNull();
  });
});

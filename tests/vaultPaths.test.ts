import { describe, expect, it } from "vitest";
import { hasControlCharacters, imageRelativePath, isImagePathInsideFolder, normalizeVaultFolder, safeImageFileName } from "../src/vaultPaths";

describe("validación de rutas del vault", () => {
  it("rechaza caracteres de control en carpetas y destinos", () => {
    expect(hasControlCharacters(`a${String.fromCharCode(0)}b`)).toBe(true);
    expect(normalizeVaultFolder(`Folder${String.fromCharCode(31)}Name`)).toBeNull();
    expect(isImagePathInsideFolder(`Images/a${String.fromCharCode(1)}.png`, "Images")).toBe(false);
  });

  it("limpia caracteres de ruta y control de nombres bibliográficos sin permitir traversal", () => {
    expect(safeImageFileName(`../A${String.fromCharCode(0)}B`)).toBe("-A-B");
    expect(imageRelativePath("Images", "../../outside")).toBe("Images/-..-outside.png");
    expect(normalizeVaultFolder("../outside")).toBeNull();
  });
});

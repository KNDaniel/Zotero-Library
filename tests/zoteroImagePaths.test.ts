import { describe, expect, it } from "vitest";
import { isZoteroKey, isZoteroLibraryCacheImagePath } from "../src/zoteroImagePaths";

describe("rutas de PNG de la caché de Zotero", () => {
  it("reconoce la ruta directa de library en Windows y POSIX sin depender del SO del runner", () => {
    expect(isZoteroLibraryCacheImagePath("C:/Z/cache/library/ABCDEFGH.png", "C:/Z")).toBe(true);
    expect(isZoteroLibraryCacheImagePath("/home/test/Zotero/cache/library/ABCDEFGH.png", "/home/test/Zotero")).toBe(true);
  });

  it("rechaza rutas fuera de library, nombres no Zotero y carpetas relativas", () => {
    expect(isZoteroLibraryCacheImagePath("C:/Z/cache/groups/ABCDEFGH.png", "C:/Z")).toBe(false);
    expect(isZoteroLibraryCacheImagePath("C:/Z/cache/library/ABCDEFGH.png/extra", "C:/Z")).toBe(false);
    expect(isZoteroLibraryCacheImagePath("C:/Z/cache/library/../../secret.png", "C:/Z")).toBe(false);
    expect(isZoteroLibraryCacheImagePath("cache/library/ABCDEFGH.png", "Zotero")).toBe(false);
  });

  it("valida las claves Zotero de ocho caracteres", () => {
    expect(isZoteroKey("ABCDEFGH")).toBe(true);
    expect(isZoteroKey("../secret")).toBe(false);
  });
});

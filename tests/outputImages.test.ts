import { describe, expect, it, vi } from "vitest";
import type { PreviewImage } from "../src/markdown";
import { copyImages, type ImageIO } from "../src/output/images";

const source: PreviewImage = {
  relativePath: "Images/ABCDEFGH.png",
  absolutePath: "/zotero/cache/library/ABCDEFGH.png",
  key: "ABCDEFGH",
};

function fakeIO(realSource = source.absolutePath) {
  const io: ImageIO = {
    vaultExists: vi.fn(async () => false),
    diskExists: vi.fn(async () => true),
    realpath: vi.fn(async () => realSource),
    readDisk: vi.fn(async () => new ArrayBuffer(4)),
    ensureFolder: vi.fn(async () => undefined),
    writeVault: vi.fn(async () => undefined),
  };
  return io;
}

describe("copia de imágenes de Zotero", () => {
  it("rechaza enlaces simbólicos cuyo destino real sale de cache/library", async () => {
    const io = fakeIO("/private/secret.png");
    const result = await copyImages([source], io, "Images", "/zotero");
    expect(result.failed).toHaveLength(1);
    expect(io.readDisk).not.toHaveBeenCalled();
    expect(io.writeVault).not.toHaveBeenCalled();
  });

  it("rechaza destinos con traversal antes de leer el archivo", async () => {
    const io = fakeIO();
    const result = await copyImages([{ ...source, relativePath: "Images/../outside.png" }], io, "Images", "/zotero");
    expect(result.failed).toHaveLength(1);
    expect(io.diskExists).not.toHaveBeenCalled();
    expect(io.readDisk).not.toHaveBeenCalled();
  });

  it("lee del origen permitido y escribe solo en el destino del vault", async () => {
    const io = fakeIO();
    const result = await copyImages([source], io, "Images", "/zotero");
    expect(result.copied).toEqual([source.relativePath]);
    expect(io.readDisk).toHaveBeenCalledWith(source.absolutePath);
    expect(io.writeVault).toHaveBeenCalledWith(source.relativePath, expect.any(ArrayBuffer));
  });
});

import { describe, expect, it } from "vitest";
import { defaultSettings, mergeStoredSettings } from "../src/settings";

describe("ajustes persistidos", () => {
  it("conserva valores válidos y descarta tipos incorrectos y claves desconocidas", () => {
    const merged = mergeStoredSettings({
      baseUrl: "http://127.0.0.1:23119",
      useDiskCache: false,
      lastSyncAt: 123,
      openNewNote: "sí",
      untrustedProperty: "ignored",
    });
    expect(merged.baseUrl).toBe("http://127.0.0.1:23119");
    expect(merged.useDiskCache).toBe(false);
    expect(merged.lastSyncAt).toBe(123);
    expect(merged.openNewNote).toBe(defaultSettings().openNewNote);
    expect("untrustedProperty" in merged).toBe(false);
  });

  it("restaura valores predeterminados para datos no-objeto y rutas fuera del vault", () => {
    expect(mergeStoredSettings(null)).toEqual(defaultSettings());
    const merged = mergeStoredSettings({ templatesFolder: "../outside", imagesFolder: "C:\\private" });
    expect(merged.templatesFolder).toBe(defaultSettings().templatesFolder);
    expect(merged.imagesFolder).toBe(defaultSettings().imagesFolder);
  });

  it("rechaza timestamps negativos, infinitos y no numéricos", () => {
    expect(mergeStoredSettings({ lastSyncAt: -1 }).lastSyncAt).toBe(0);
    expect(mergeStoredSettings({ lastSyncAt: Number.POSITIVE_INFINITY }).lastSyncAt).toBe(0);
    expect(mergeStoredSettings({ lastSyncAt: "123" }).lastSyncAt).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { validateLibraryPath, validateZoteroBaseUrl } from "../src/source/endpoint";

describe("validación del destino Zotero", () => {
  it("permite loopback local y normaliza el origen", () => {
    expect(validateZoteroBaseUrl("http://127.0.0.1:23119/")).toBe("http://127.0.0.1:23119");
    expect(validateZoteroBaseUrl("http://[::1]:23119")).toBe("http://[::1]:23119");
    expect(validateZoteroBaseUrl("http://localhost:23119")).toBe("http://localhost:23119");
  });

  it("rechaza destinos remotos, rutas, credenciales y parámetros sin consentimiento", () => {
    for (const url of ["https://zotero.example.org", "http://127.0.0.1:23119/api", "http://user:secret@127.0.0.1:23119", "http://127.0.0.1:23119?token=x"]) {
      expect(() => validateZoteroBaseUrl(url)).toThrow();
    }
  });

  it("acepta host remoto solo con consentimiento y HTTPS", () => {
    expect(validateZoteroBaseUrl("https://zotero.example.org:8443", true)).toBe("https://zotero.example.org:8443");
    expect(() => validateZoteroBaseUrl("http://zotero.example.org:8443", true)).toThrow(/HTTPS/);
  });

  it("solo acepta direcciones IPv4 loopback válidas como locales", () => {
    expect(validateZoteroBaseUrl("http://127.0.0.2:23119")).toBe("http://127.0.0.2:23119");
    expect(() => validateZoteroBaseUrl("http://127.999.999.999:23119")).toThrow();
  });

  it("valida rutas de biblioteca en formato de usuario o grupo", () => {
    expect(validateLibraryPath("/users/0/")).toBe("users/0");
    expect(validateLibraryPath("groups/12345")).toBe("groups/12345");
    for (const path of ["../users/0", "users/0/items", "groups/x", "https://example.org"]) expect(() => validateLibraryPath(path)).toThrow();
  });
});

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/release-package.mjs");
const temporaryRoots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "zotero-library-release-"));
  temporaryRoots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.9.6", license: "MIT" }));
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ id: "zotero-library", version: "0.9.6", minAppVersion: "1.15.0", description: "Explora Zotero y crea notas.", isDesktopOnly: true }));
  writeFileSync(join(root, "README.md"), "Documentación del plugin\n");
  writeFileSync(join(root, "CHANGELOG.md"), "Cambios publicados\n");
  writeFileSync(join(root, "THIRD-PARTY-NOTICES.md"), "Avisos de dependencias\n");
  writeFileSync(join(root, "LICENSE"), "Licencia elegida por el titular\n");
  for (const name of ["main.js", "styles.css"]) writeFileSync(join(root, name), `artefacto ${name}`);
  return root;
};
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("paquete de distribución", () => {
  it("prepara una carpeta instalable con solo los tres artefactos", () => {
    const root = fixture();
    const output = join(root, "dist", "0.9.6");
    const prepared = run("prepare", "--root", root, "--out", output);
    expect(prepared.status).toBe(0);
    expect(run("verify", "--", output, "--root", root).status).toBe(0);
    expect(readFileSync(join(output, "manifest.json"), "utf8")).toContain('"version":"0.9.6"');
  });

  it("rechaza versiones distintas entre package.json y manifest.json", () => {
    const root = fixture();
    writeFileSync(join(root, "manifest.json"), JSON.stringify({ id: "zotero-library", version: "0.9.5", minAppVersion: "1.15.0", description: "Explora Zotero y crea notas.", isDesktopOnly: true }));
    const result = run("prepare", "--root", root, "--out", join(root, "dist"));
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/versiones.*no coinciden/i);
  });

  it("acepta solo versiones estables x.y.z para el directorio de Obsidian", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "v0.9.6", license: "MIT" }));
    const result = run("prepare", "--root", root, "--out", join(root, "dist", "candidate"));
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/SemVer estable x\.y\.z/i);
  });

  it("requiere que package.json declare la licencia SPDX elegida", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.9.6" }));
    const result = run("prepare", "--root", root, "--out", join(root, "dist", "candidate"));
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/package\.json debe declarar la licencia/i);
  });

  it("rechaza contenido adicional en el paquete, como datos o registros", () => {
    const root = fixture();
    const output = join(root, "dist", "candidate");
    mkdirSync(output, { recursive: true });
    for (const name of ["main.js", "manifest.json", "styles.css"]) {
      writeFileSync(join(output, name), readFileSync(join(root, name)));
    }
    writeFileSync(join(output, "data.json"), "datos personales");
    const result = run("verify", output, "--root", root);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/contenido no permitido/i);
  });

  it("impide verificar un candidato publicable si falta README, changelog o licencia", () => {
    const root = fixture();
    const output = join(root, "dist", "candidate");
    const prepared = run("prepare", "--root", root, "--out", output);
    expect(prepared.status).toBe(0);
    rmSync(join(root, "LICENSE"));
    const result = run("verify", output, "--root", root);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/falta LICENSE/i);
  });
});

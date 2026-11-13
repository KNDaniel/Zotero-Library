import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACTS = ["main.js", "manifest.json", "styles.css"];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`No se pudo leer JSON válido en ${path}: ${error.message}`);
  }
}

async function regularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function sourceMetadata(root) {
  const packageJson = await readJson(resolve(root, "package.json"));
  const manifest = await readJson(resolve(root, "manifest.json"));
  if (!SEMVER.test(packageJson.version ?? "") || !SEMVER.test(manifest.version ?? "")) {
    throw new Error("La versión debe usar SemVer estable x.y.z, sin prefijo ni sufijo.");
  }
  if (packageJson.version !== manifest.version) {
    throw new Error(`Las versiones de package.json (${packageJson.version}) y manifest.json (${manifest.version}) no coinciden.`);
  }
  if (!packageJson.license) throw new Error("package.json debe declarar la licencia elegida en SPDX.");
  if (!manifest.id || manifest.id.includes("obsidian")) throw new Error("manifest.json debe tener un id válido y no puede incluir «obsidian».");
  if (!manifest.isDesktopOnly) throw new Error("manifest.json debe declarar isDesktopOnly: true porque el plugin usa APIs de Node/Electron.");
  if (typeof manifest.description !== "string" || manifest.description.length > 250 || !manifest.description.endsWith(".")) {
    throw new Error("La descripción del manifiesto debe tener como máximo 250 caracteres y terminar en punto.");
  }
  return { packageJson, manifest };
}

function isInside(parent, target) {
  const pathFromParent = relative(parent, target);
  return pathFromParent !== "" && pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

async function verifyArtifactDirectory(directory, expectedVersion) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error(`No existe la carpeta de distribución: ${directory}`);
  }
  const actual = entries.map((entry) => entry.name).sort();
  const expected = [...ARTIFACTS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected) || entries.some((entry) => !entry.isFile())) {
    const extra = actual.filter((name) => !expected.includes(name));
    const missing = expected.filter((name) => !actual.includes(name));
    throw new Error(`Contenido no permitido o incompleto en el paquete. Extras: ${extra.join(", ") || "ninguno"}; faltan: ${missing.join(", ") || "ninguno"}. Solo se admiten ${ARTIFACTS.join(", ")}.`);
  }
  for (const name of ARTIFACTS) {
    if ((await stat(resolve(directory, name))).size === 0) throw new Error(`El artefacto ${name} está vacío.`);
  }
  const manifest = await readJson(resolve(directory, "manifest.json"));
  if (manifest.version !== expectedVersion) throw new Error(`La versión del paquete (${manifest.version}) no coincide con la fuente (${expectedVersion}).`);
  return expectedVersion;
}

async function prepare(root, output) {
  const { manifest } = await sourceMetadata(root);
  const target = resolve(output ?? resolve(root, "dist", `zotero-library-${manifest.version}`));
  if (!isInside(resolve(root, "dist"), target)) throw new Error("La carpeta del candidato debe quedar dentro de dist/ en el proyecto.");
  for (const name of ARTIFACTS) {
    const source = resolve(root, name);
    if (!(await regularFile(source))) throw new Error(`Falta el artefacto de producción ${name}; ejecuta pnpm run build primero.`);
  }
  await mkdir(target, { recursive: true });
  for (const name of ARTIFACTS) await copyFile(resolve(root, name), resolve(target, name));
  await verifyArtifactDirectory(target, manifest.version);
  console.log(`Candidato local preparado y verificado: ${target}`);
  console.log(`Archivos instalables: ${ARTIFACTS.join(", ")} · versión ${manifest.version}`);
}

async function verify(root, directory) {
  const { manifest } = await sourceMetadata(root);
  for (const name of ["README.md", "CHANGELOG.md", "THIRD-PARTY-NOTICES.md", "LICENSE"]) {
    const path = resolve(root, name);
    if (!(await regularFile(path)) || (await stat(path)).size === 0) throw new Error(`Falta ${name} o está vacío; no se puede marcar el repositorio listo para publicación.`);
  }
  await verifyArtifactDirectory(resolve(directory), manifest.version);
  console.log(`Candidato de publicación verificado: ${resolve(directory)} · ${manifest.version}`);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
}

async function main(args) {
  const root = resolve(valueAfter(args, "--root") ?? process.cwd());
  const command = args[0];
  if (command === "prepare") return prepare(root, valueAfter(args, "--out"));
  if (command === "verify" && args[1] && !args[1].startsWith("--")) return verify(root, args[1]);
  throw new Error("Uso: node scripts/release-package.mjs prepare [--root ruta] [--out ruta] | verify <carpeta-candidato> [--root ruta]");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2).filter((argument) => argument !== "--")).catch((error) => {
    console.error(`No se pudo preparar/verificar el candidato: ${error.message}`);
    process.exitCode = 1;
  });
}

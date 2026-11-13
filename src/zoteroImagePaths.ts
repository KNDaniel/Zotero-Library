import { isAbsolute, relative, resolve, sep } from "node:path";

const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
const IMAGE_FILE = /^[A-Z0-9]{8}\.png$/;

export function isZoteroKey(value: unknown): value is string {
  return typeof value === "string" && ZOTERO_KEY.test(value);
}

/** Solo admite archivos PNG directos en cache/library con el nombre de una clave Zotero. */
export function isZoteroLibraryCacheImagePath(filePath: string, dataDir: string): boolean {
  if (!dataDir.trim() || !isAbsolute(filePath)) return false;

  const root = resolve(dataDir, "cache", "library");
  const file = resolve(filePath);
  const fromRoot = relative(root, file);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot) || fromRoot.includes(sep)) return false;

  return IMAGE_FILE.test(fromRoot);
}

import { posix, win32 } from "node:path";

const ZOTERO_KEY = /^[A-Z0-9]{8}$/;
const IMAGE_FILE = /^[A-Z0-9]{8}\.png$/;

export function isZoteroKey(value: unknown): value is string {
  return typeof value === "string" && ZOTERO_KEY.test(value);
}

/** Solo admite archivos PNG directos en cache/library con el nombre de una clave Zotero. */
export function isZoteroLibraryCacheImagePath(filePath: string, dataDir: string): boolean {
  if (!dataDir.trim()) return false;
  // Zotero data paths can use either platform's syntax in imported records and
  // fixtures. Select the matching path rules instead of relying on the host OS.
  const pathApi = win32.isAbsolute(filePath) || win32.isAbsolute(dataDir) ? win32 : posix;
  if (!pathApi.isAbsolute(filePath) || !pathApi.isAbsolute(dataDir)) return false;

  const root = pathApi.resolve(dataDir, "cache", "library");
  const file = pathApi.resolve(filePath);
  const fromRoot = pathApi.relative(root, file);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(fromRoot) || fromRoot.includes(pathApi.sep)) return false;

  return IMAGE_FILE.test(fromRoot);
}

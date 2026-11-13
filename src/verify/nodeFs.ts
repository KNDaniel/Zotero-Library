import type { FsLike } from "./verify";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Adapta las operaciones de filesystem de Node al informe de verificación. */
export function createNodeFs(
  access: (path: string) => Promise<unknown>,
  readdir: (path: string) => Promise<string[]>,
  realpath?: (path: string) => Promise<string>,
  allowedRoot?: string,
): FsLike {
  const root = allowedRoot && isAbsolute(allowedRoot) ? resolve(allowedRoot) : null;
  const contained = async (path: string): Promise<string> => {
    if (!root) throw new Error("No hay una carpeta raíz absoluta autorizada para consultar el sistema de archivos.");
    if (!isAbsolute(path) || !realpath) throw new Error("La ruta no se pudo validar dentro de la carpeta autorizada.");
    const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(path)]);
    const rel = relative(realRoot, realTarget);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error("La ruta resuelta queda fuera de la carpeta de datos de Zotero.");
    }
    return realTarget;
  };
  return {
    exists: async (path) => {
      // Never fall back to an unrestricted access check when the allowed root
      // is missing, invalid, or cannot be canonicalized.
      let realTarget: string;
      try { realTarget = await contained(path); } catch { return false; }
      return access(realTarget).then(() => true, () => false);
    },
    // No convertir fallos de lectura en una carpeta vacía: el guard del informe
    // debe presentar el error real para que se pueda diagnosticar.
    readdir: async (path) => {
      const realTarget = await contained(path);
      return readdir(realTarget);
    },
  };
}

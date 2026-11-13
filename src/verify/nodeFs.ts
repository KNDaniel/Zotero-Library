import type { FsLike } from "./verify";

/** Adapta las operaciones de filesystem de Node al informe de verificación. */
export function createNodeFs(
  access: (path: string) => Promise<unknown>,
  readdir: (path: string) => Promise<string[]>,
): FsLike {
  return {
    exists: (path) => access(path).then(() => true, () => false),
    // No convertir fallos de lectura en una carpeta vacía: el guard del informe
    // debe presentar el error real para que se pueda diagnosticar.
    readdir,
  };
}

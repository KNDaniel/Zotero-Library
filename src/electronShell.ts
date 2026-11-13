export interface ElectronShellApi {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const then: unknown = Reflect.get(value, "then");
  return typeof then === "function";
}

/** Adapta de forma defensiva el require de Electron disponible en Obsidian escritorio. */
export function getElectronShell(requireElectron: unknown, receiver: unknown): ElectronShellApi | null {
  try {
    if (typeof requireElectron !== "function") return null;
    const electron: unknown = Reflect.apply(requireElectron, receiver, ["electron"]);
    if (!electron || typeof electron !== "object") return null;
    const shell: unknown = Reflect.get(electron, "shell");
    if (!shell || typeof shell !== "object") return null;
    const openPath: unknown = Reflect.get(shell, "openPath");
    const showItemInFolder: unknown = Reflect.get(shell, "showItemInFolder");
    if (typeof openPath !== "function" || typeof showItemInFolder !== "function") return null;
    return {
      openPath: async (path) => {
        const result: unknown = Reflect.apply(openPath, shell, [path]);
        if (!isPromiseLike(result)) throw new TypeError("Electron shell.openPath no devolvió una promesa válida.");
        const error: unknown = await Promise.resolve(result);
        if (typeof error !== "string") throw new TypeError("Electron shell.openPath devolvió un resultado no válido.");
        return error;
      },
      showItemInFolder: (path) => { Reflect.apply(showItemInFolder, shell, [path]); },
    };
  } catch {
    return null;
  }
}

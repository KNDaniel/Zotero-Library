const INVALID_FILE_CHARS = new Set(["\\", "/", ":", "*", "?", "\"", "<", ">", "|", "#", "^", "[", "]"]);

/** Rechaza los caracteres de control que no pueden formar componentes de ruta. */
export function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) < 0x20) return true;
  return false;
}

/** Normaliza una carpeta relativa a la raíz del vault; null si intenta salir de ella. */
export function normalizeVaultFolder(folder: string): string | null {
  if (/^[\\/]/.test(folder) || /^[A-Za-z]:/.test(folder)) return null;
  const normalized = folder.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!normalized) return "";
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes(":") || hasControlCharacters(part))) return null;
  return parts.join("/");
}

/** Convierte la plantilla a un solo nombre de archivo, sin componentes de ruta. */
export function safeImageFileName(name: string): string | null {
  const clean = name
    .split("").map((char) => INVALID_FILE_CHARS.has(char) || hasControlCharacters(char) ? "-" : char).join("")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
  return clean && clean !== "." && clean !== ".." ? clean : null;
}

/** Ruta de imagen del vault: siempre una hoja `.png` directamente dentro de la carpeta configurada. */
export function imageRelativePath(folder: string, name: string): string | null {
  const root = normalizeVaultFolder(folder);
  const file = safeImageFileName(name);
  if (root === null || file === null) return null;
  return `${root ? `${root}/` : ""}${file}.png`;
}

/** Defensa en el punto de escritura: acepta solo un PNG hoja bajo la carpeta esperada. */
export function isImagePathInsideFolder(path: string, folder: string): boolean {
  const root = normalizeVaultFolder(folder);
  if (root === null || /^[\\/]/.test(path) || /^[A-Za-z]:/.test(path) || path.includes("\\")) return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes(":") || hasControlCharacters(part))) return false;
  const rootParts = root ? root.split("/") : [];
  const fileName = parts[parts.length - 1];
  return fileName !== undefined && parts.length === rootParts.length + 1 && rootParts.every((part, i) => parts[i] === part) && fileName.toLowerCase().endsWith(".png");
}

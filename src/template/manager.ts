/** Gestión de plantillas: qué archivos de la carpeta cuentan y cómo se localizan. */

export const TEMPLATE_EXTENSIONS = ["md", "njk", "txt"];

export interface TemplateFile {
  /** Ruta completa dentro del vault */
  path: string;
  content: string;
}

export interface TemplatePathNode {
  path: string;
  children?: TemplatePathNode[];
}

const stripExt = (p: string) => p.replace(/\.[^./\\]+$/, "");
const baseName = (p: string) => p.split("/").pop() ?? p;

/** Ruta de `path` relativa a `folder`, o null si el archivo no está dentro. */
export function relativeToFolder(path: string, folder: string): string | null {
  const f = folder.replace(/^\/+|\/+$/g, "");
  if (!f) return path;
  return path.startsWith(`${f}/`) ? path.slice(f.length + 1) : null;
}

export function isTemplatePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TEMPLATE_EXTENSIONS.includes(ext);
}

/**
 * Mapa nombre -> contenido para {% include %} / {% import %}. Cada plantilla se
 * puede citar por su ruta relativa (con o sin extensión) o, si no hay
 * ambigüedad, por su nombre de archivo.
 */
export function buildTemplateMap(files: TemplateFile[], folder: string): Map<string, string> {
  const map = new Map<string, string>();
  const byBase = new Map<string, string[]>();
  for (const f of files) {
    const rel = relativeToFolder(f.path, folder);
    if (rel === null || !isTemplatePath(rel)) continue;
    map.set(rel, f.content);
    map.set(stripExt(rel), f.content);
    byBase.set(baseName(rel), [...(byBase.get(baseName(rel)) ?? []), f.content]);
    byBase.set(baseName(stripExt(rel)), [...(byBase.get(baseName(stripExt(rel))) ?? []), f.content]);
  }
  for (const [name, contents] of byBase) if (contents.length === 1 && !map.has(name)) map.set(name, contents[0]);
  return map;
}

/** Rutas relativas de las plantillas de una carpeta, ordenadas. */
export function listTemplates(paths: string[], folder: string): string[] {
  return paths
    .map((p) => relativeToFolder(p, folder))
    .filter((p): p is string => p !== null && isTemplatePath(p))
    .sort((a, b) => a.localeCompare(b, "es"));
}

/** Enumera solo la rama del vault que contiene las plantillas configuradas. */
export function listTemplatesInTree(root: TemplatePathNode, folder: string): string[] {
  const paths: string[] = [];
  const visit = (node: TemplatePathNode): void => {
    if (!node.children) {
      paths.push(node.path);
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return listTemplates(paths, folder);
}

/**
 * Lógica del explorador de datos (sin DOM): rutas de variables, nodos hijos y búsqueda.
 * Trabaja sobre el mismo contexto que reciben las plantillas, así que lo que se ve
 * aquí es exactamente lo que se puede escribir en una plantilla.
 */

export type PathSeg = string | number;
export type ValueKind = "object" | "array" | "string" | "number" | "boolean" | "null" | "empty";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Expresión Nunjucks de una ruta: `annotations[0].comment`, `fields["Short Title"]`… */
export function pathExpression(path: PathSeg[]): string {
  let out = "";
  path.forEach((seg, i) => {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (IDENT.test(seg)) out += i === 0 ? seg : `.${seg}`;
    else out += `[${JSON.stringify(seg)}]`;
  });
  return out;
}

/** Lo que se copia al hacer clic: `{{ variable }}`. */
export const templateVariable = (path: PathSeg[]): string => `{{ ${pathExpression(path)} }}`;

export function kindOf(v: unknown): ValueKind {
  if (v === undefined) return "empty";
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Vista corta de un valor, en una línea. */
export function previewOf(v: unknown, max = 90): string {
  switch (kindOf(v)) {
    case "empty":
      return "(vacío)";
    case "null":
      return "null";
    case "array":
      return `[${(v as unknown[]).length}]`;
    case "object":
      return `{${Object.keys(v as object).length}}`;
    case "string": {
      const s = collapse(v as string);
      return `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"`;
    }
    default:
      return String(v);
  }
}

/** Lo que se copia al hacer clic en un valor: el texto completo, sin comillas ni recortes (las listas y objetos, como JSON). */
export function valueText(v: unknown): string {
  switch (kindOf(v)) {
    case "empty":
      return "";
    case "null":
      return "null";
    case "string":
      return v as string;
    case "array":
    case "object":
      try {
        return JSON.stringify(v, null, 2);
      } catch {
        return String(v);
      }
    default:
      return String(v);
  }
}

export interface ExplorerNode {
  path: PathSeg[];
  /** Último segmento tal como se muestra: `title`, `0`… */
  label: string;
  kind: ValueKind;
  value: unknown;
  /** Hijos directos (0 para valores simples) */
  size: number;
}

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

function sizeOf(v: unknown): number {
  const k = kindOf(v);
  if (k === "array") return (v as unknown[]).length;
  if (k === "object") return Object.keys(v as object).length;
  return 0;
}

function makeNode(path: PathSeg[], value: unknown): ExplorerNode {
  const last = path[path.length - 1];
  return { path, label: last === undefined ? "" : String(last), kind: kindOf(value), value, size: sizeOf(value) };
}

/** Raíz del árbol: las variables de primer nivel, ordenadas por nombre. */
export function rootNodes(ctx: Record<string, unknown>): ExplorerNode[] {
  return Object.keys(ctx)
    .sort((a, b) => collator.compare(a, b))
    .map((k) => makeNode([k], ctx[k]));
}

/** Hijos de un nodo: índices de una lista (en orden) o claves de un objeto (por nombre). */
export function childNodes(node: ExplorerNode): ExplorerNode[] {
  if (node.kind === "array") return (node.value as unknown[]).map((v, i) => makeNode([...node.path, i], v));
  if (node.kind === "object") {
    const o = node.value as Record<string, unknown>;
    return Object.keys(o)
      .sort((a, b) => collator.compare(a, b))
      .map((k) => makeNode([...node.path, k], o[k]));
  }
  return [];
}

const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export interface SearchResult {
  nodes: ExplorerNode[];
  /** Hubo más coincidencias de las que se devuelven */
  truncated: boolean;
}

/**
 * Busca en todo el árbol: cada palabra de la consulta debe aparecer en la ruta o en el valor
 * (sin mayúsculas ni tildes). Los valores simples y los contenedores cuya ruta coincide cuentan.
 */
export function searchNodes(ctx: Record<string, unknown>, query: string, opts: { limit?: number; maxDepth?: number; maxVisited?: number } = {}): SearchResult {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return { nodes: [], truncated: false };
  const limit = opts.limit ?? 300;
  const maxDepth = opts.maxDepth ?? 8;
  const maxVisited = opts.maxVisited ?? 250_000;
  const nodes: ExplorerNode[] = [];
  let visited = 0;
  let truncated = false;
  const ancestors = new Set<object>();

  const visit = (node: ExplorerNode): boolean => {
    if (++visited > maxVisited) {
      truncated = true;
      return false;
    }
    const scalar = node.size === 0 && node.kind !== "array" && node.kind !== "object";
    const hay = fold(`${pathExpression(node.path)} ${scalar ? previewOf(node.value, 400) : ""}`);
    if (words.every((w) => hay.includes(w))) {
      if (nodes.length >= limit) {
        truncated = true;
        return false;
      }
      nodes.push(node);
    }
    if (node.size > 0 && node.path.length < maxDepth) {
      const obj = node.value as object;
      if (ancestors.has(obj)) return true; // referencia circular
      ancestors.add(obj);
      for (const child of childNodes(node)) if (!visit(child)) return false;
      ancestors.delete(obj);
    }
    return true;
  };

  for (const n of rootNodes(ctx)) if (!visit(n)) break;
  return { nodes, truncated };
}

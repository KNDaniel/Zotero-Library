import { safeFileName } from "../template/defaultNotes";
import type { TemplateEngine } from "../template/engine";

/** Nombre por defecto de las notas nuevas: el que se usaba antes de poder configurarlo («Zotero Library 2026-11-10 0255»). */
export const DEFAULT_NOTE_NAME_TEMPLATE = "Zotero Library {{ stamp }}";
/** Longitud máxima del nombre (sin la extensión) */
export const MAX_NOTE_NAME_LENGTH = 120;

/** Quita lo que no puede llevar el nombre de un archivo (y los caracteres que rompen enlaces de Obsidian), recorta y limita la longitud. */
export function sanitizeNoteName(raw: string): string {
  const clean = safeFileName(raw.replace(/[\r\n]+/g, " "));
  return clean.slice(0, MAX_NOTE_NAME_LENGTH).replace(/[. ]+$/, "").trim();
}

export interface NoteNameInput {
  /** Plantilla Nunjucks del nombre (vacía = la de por defecto) */
  template: string;
  /** Variables del ítem o de la anotación cuando la nota trata de uno solo; null con varios */
  context: Record<string, unknown> | null;
  /** Fecha y hora con el formato de siempre, disponible como {{ stamp }} */
  stamp: string;
  /** Cuántos ítems (o anotaciones) lleva la nota, disponible como {{ count }} */
  count: number;
}

/**
 * Nombre de una nota nueva. Con un solo ítem o anotación están todas sus variables; con varios solo `stamp` y `count`
 * (las demás quedan vacías). Si la plantilla falla o el nombre queda vacío, se usa el de por defecto.
 */
export function noteBaseName(engine: TemplateEngine, input: NoteNameInput): string {
  const vars = { ...(input.context ?? {}), stamp: input.stamp, count: input.count };
  const render = (tpl: string): string => {
    try {
      return sanitizeNoteName(engine.render(tpl, vars, "nombre de la nota"));
    } catch {
      return "";
    }
  };
  return render(input.template.trim() || DEFAULT_NOTE_NAME_TEMPLATE) || render(DEFAULT_NOTE_NAME_TEMPLATE) || sanitizeNoteName(`Zotero Library ${input.stamp}`);
}

/**
 * Ruta libre para la nota: si el nombre ya existe se le añade la clave de Zotero (cuando la nota trata de un solo ítem o
 * anotación) y, si aun así existe, un número entre paréntesis.
 */
export async function uniqueNotePath(dir: string, base: string, key: string | null, exists: (path: string) => Promise<boolean>): Promise<string> {
  const path = (name: string): string => `${dir}${name}.md`;
  if (!(await exists(path(base)))) return path(base);
  let name = base;
  if (key) {
    name = `${base} ${key}`;
    if (!(await exists(path(name)))) return path(name);
  }
  for (let n = 2; ; n++) if (!(await exists(path(`${name} (${n})`)))) return path(`${name} (${n})`);
}

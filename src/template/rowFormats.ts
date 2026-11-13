/**
 * Formatos de fila de la lista de ítems. Son plantillas Nunjucks de UNA línea,
 * independientes de las plantillas de ítem, anotación e impresión. Reciben el
 * mismo contexto que una plantilla de ítem (`title`, `year`, `authors`,
 * `itemType`, cualquier campo de Zotero…) más `firstAuthorSurname` y `authorSurnames`.
 */
export interface RowFormat {
  id: string;
  label: string;
  source: string;
}

const T = `{{ title or "(sin título)" }}`;
const A = `{{ firstAuthorSurname or "s. a." }}`;
const Y = `{{ year or "s. f." }}`;

export const ROW_FORMATS: RowFormat[] = [
  { id: "author-year-title", label: "Autor (Año) — Título", source: `${A} (${Y}) — ${T}` },
  { id: "authors-year-title", label: "Todos los Autores (Año) — Título", source: `{{ authorSurnames or "s. a." }} (${Y}) — ${T}` },
  { id: "author-title", label: "Autor — Título", source: `${A} — ${T}` },
  { id: "title-year", label: "Título (Año)", source: `${T} (${Y})` },
  { id: "title", label: "Solo Título", source: T },
  { id: "type-author-title", label: "Tipo · Autor · Título", source: `{{ itemTypeLabel }} · ${A} · ${T}` },
];

export const DEFAULT_ROW_FORMAT_ID = "builtin:author-year-title";
export const BUILTIN_PREFIX = "builtin:";

export interface ResolvedRowFormat {
  /** Identificador estable para detectar cambios y cachear */
  name: string;
  source: string;
  /** Plantilla pedida que no existe: se usó la incluida por defecto */
  missing?: string;
}

/** Formato elegido en la lista > formato por defecto de los ajustes > Autor (Año) — Título. */
export function resolveRowFormat(choice: string, settingsDefault: string, templates: Map<string, string>): ResolvedRowFormat {
  const wanted = choice || settingsDefault || DEFAULT_ROW_FORMAT_ID;
  if (wanted.startsWith(BUILTIN_PREFIX)) {
    const f = ROW_FORMATS.find((r) => BUILTIN_PREFIX + r.id === wanted);
    if (f) return { name: wanted, source: f.source };
  } else {
    const source = templates.get(wanted);
    if (source !== undefined) return { name: wanted, source };
  }
  const fallback = ROW_FORMATS[0];
  return { name: BUILTIN_PREFIX + fallback.id, source: fallback.source, missing: wanted };
}

/** El resultado de una fila siempre es una sola línea de texto plano. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

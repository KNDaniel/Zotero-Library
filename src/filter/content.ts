import type { ZoteroAnnotation } from "../model/types";
import { norm } from "./text";

/** Dónde se busca dentro de cada anotación. */
export type ContentScope = "both" | "comment" | "text";

export const CONTENT_SCOPES: Array<{ value: ContentScope; label: string }> = [
  { value: "both", label: "Texto y comentario" },
  { value: "text", label: "Solo texto resaltado" },
  { value: "comment", label: "Solo comentario" },
];

/**
 * Una búsqueda de contenido es una lista de alternativas (separadas por `|`);
 * cada alternativa es una lista de palabras que deben aparecer todas.
 *   «clase obrera | proletariado»  =  (clase Y obrera) O proletariado
 */
export type ContentQuery = string[][];

/** Quita etiquetas HTML (<i>, <sup>…) y entidades comunes, para buscar solo en el texto visible. */
export function plainText(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parseContentQuery(text: string): ContentQuery {
  return text
    .split("|")
    .map((alt) => norm(alt).split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0);
}

/** Todas las palabras de la búsqueda (para resaltarlas), sin repetir. */
export function contentTerms(query: ContentQuery): string[] {
  return [...new Set(query.flat())];
}

export function contentMatches(haystack: string, query: ContentQuery): boolean {
  if (!query.length) return true;
  const h = norm(haystack);
  return query.some((words) => words.every((w) => h.includes(w)));
}

export interface ContentFilter {
  query: ContentQuery;
  scope: ContentScope;
  matches(a: ZoteroAnnotation): boolean;
}

/** null si no hay nada que buscar (el filtro no se aplica). */
export function buildContentFilter(text: string, scope: ContentScope): ContentFilter | null {
  const query = parseContentQuery(text);
  if (!query.length) return null;
  return {
    query,
    scope,
    matches(a) {
      const parts = scope === "text" ? [a.text] : scope === "comment" ? [a.comment] : [a.text, a.comment];
      return contentMatches(parts.map((p) => plainText(p ?? "")).join("\n"), query);
    },
  };
}

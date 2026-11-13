/** De la bibliografía en HTML que entrega Zotero (CSL) a líneas de Markdown. */

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m);
}

/** Cursiva y negrita pasan a Markdown, los enlaces también; <sup> y <sub> se conservan; el resto de etiquetas se quitan. */
export function htmlToMarkdown(html: string): string {
  let s = html;
  s = s.replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<\/div>/gi, " ");
  s = s.replace(/<(?!\/?(?:sup|sub)\b)[^>]+>/gi, "");
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

/**
 * Entradas de una bibliografía (`<div class="csl-entry">…</div>`), incluidas las
 * de estilos numéricos, que anidan otros <div>. Si no hay ninguna, se devuelve el
 * texto entero como una sola entrada.
 */
export function bibHtmlToEntries(html: string): string[] {
  const entries: string[] = [];
  const start = /<div\b[^>]*class="[^"]*\bcsl-entry\b[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = start.exec(html))) {
    let depth = 1;
    const tag = /<(\/?)div\b[^>]*>/gi;
    tag.lastIndex = start.lastIndex;
    let t: RegExpExecArray | null;
    let end = html.length;
    while ((t = tag.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index;
        break;
      }
    }
    const md = htmlToMarkdown(html.slice(start.lastIndex, end));
    if (md) entries.push(md);
    start.lastIndex = end;
  }
  if (!entries.length) {
    const whole = htmlToMarkdown(html);
    if (whole) entries.push(whole);
  }
  return entries;
}

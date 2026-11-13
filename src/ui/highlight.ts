/**
 * Resaltado de coincidencias dentro de una tarjeta ya dibujada. Compara sin
 * mayúsculas ni tildes (igual que la búsqueda) y solo toca nodos de texto, así
 * que no rompe enlaces, imágenes ni el resto del HTML.
 */

const baseChar = (ch: string): string => ch.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

/** Rangos [inicio, fin) del texto original donde aparece alguno de los términos (ya normalizados). */
export function findRanges(text: string, terms: string[]): Array<[number, number]> {
  if (!terms.length) return [];
  // Texto normalizado carácter a carácter, recordando a qué posición original corresponde cada uno.
  let normalized = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    for (const c of baseChar(ch)) {
      normalized += c;
      map.push(i);
    }
    i += ch.length;
  }
  const hits: Array<[number, number]> = [];
  for (const term of terms) {
    if (!term) continue;
    for (let at = normalized.indexOf(term); at !== -1; at = normalized.indexOf(term, at + term.length)) {
      const start = map[at];
      const last = map[at + term.length - 1];
      const lastCp = String.fromCodePoint(text.codePointAt(last)!);
      hits.push([start, last + lastCp.length]);
    }
  }
  // Une rangos que se tocan o se solapan
  hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const h of hits) {
    const prev = merged[merged.length - 1];
    if (prev && h[0] <= prev[1]) prev[1] = Math.max(prev[1], h[1]);
    else merged.push([h[0], h[1]]);
  }
  return merged;
}

const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);

/** Envuelve en <mark class="zl-hit"> cada coincidencia; devuelve cuántas marcó. */
export function highlightTerms(root: HTMLElement, terms: string[]): number {
  if (!terms.length) return 0;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = (n as Text).parentElement;
    if (parent && !SKIP.has(parent.tagName) && !parent.closest("mark.zl-hit")) nodes.push(n as Text);
  }
  let count = 0;
  for (const node of nodes) {
    const text = node.data;
    const ranges = findRanges(text, terms);
    if (!ranges.length) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a > pos) parent.insertBefore(doc.createTextNode(text.slice(pos, a)), node);
      const mark = parent.createEl("mark", { cls: "zl-hit" });
      mark.textContent = text.slice(a, b);
      parent.insertBefore(mark, node);
      pos = b;
      count++;
    }
    if (pos < text.length) parent.insertBefore(doc.createTextNode(text.slice(pos)), node);
    node.remove();
  }
  return count;
}

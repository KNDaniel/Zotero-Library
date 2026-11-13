/** Los ocho colores estándar de anotación de Zotero. */
export const ZOTERO_COLORS: Record<string, string> = {
  yellow: "#ffd400",
  red: "#ff6666",
  green: "#5fb236",
  blue: "#2ea8e5",
  purple: "#a28ae5",
  magenta: "#e56eee",
  orange: "#f19837",
  gray: "#aaaaaa",
};

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHsl([r, g, b]: [number, number, number]): { h: number; s: number; l: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const CHROMATIC = Object.entries(ZOTERO_COLORS)
  .filter(([name]) => name !== "gray")
  .map(([name, value]) => ({ name, hue: toHsl(parseHex(value)!).h }));

/**
 * Convierte un color hexadecimal en su categoría.
 * - Los ocho colores estándar de Zotero dan `exact: true`.
 * - Cualquier otro se clasifica por su **tono** (no por distancia RGB, que
 *   confunde p. ej. un cian claro con el morado): los grisáceos van a `gray`
 *   y el resto al tono estándar más cercano, con `exact: false`.
 */
export function colorCategoryOf(hex: string): { category: string; exact: boolean } {
  const rgb = parseHex(hex);
  if (!rgb) return { category: "", exact: false };
  const lower = hex.trim().toLowerCase();
  for (const [name, value] of Object.entries(ZOTERO_COLORS)) {
    if (value === lower) return { category: name, exact: true };
  }
  const { h, s, l } = toHsl(rgb);
  if (s < 0.15 || l < 0.1 || l > 0.97) return { category: "gray", exact: false };
  let best = CHROMATIC[0];
  for (const c of CHROMATIC) if (hueDistance(h, c.hue) < hueDistance(h, best.hue)) best = c;
  return { category: best.name, exact: false };
}

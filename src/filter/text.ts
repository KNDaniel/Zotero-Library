/** Minúsculas y sin tildes, para comparar «Ideología» con «ideologia». */
export const norm = (s: string): string => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().trim();

/** Comparador de orden en español: ignora tildes y mayúsculas, números en orden natural. */
export const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

export function intToRoman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

/** Número romano válido (forma canónica) o null. */
export function romanToInt(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!/^[ivxlcdm]+$/.test(t)) return null;
  let total = 0;
  for (let i = 0; i < t.length; i++) {
    const cur = ROMAN_VALUES[t[i]];
    const next = ROMAN_VALUES[t[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total > 0 && intToRoman(total) === t.toUpperCase() ? total : null;
}

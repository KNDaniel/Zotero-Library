/**
 * Convierte una fecha de Zotero a YYYY-MM-DD. Las fechas parciales se
 * completan con 01 (2010 -> 2010-01-01, 2010-06 -> 2010-06-01).
 * Prueba primero `meta.parsedDate`, luego el texto libre del campo `date`
 * y, como último recurso, el primer año de cuatro cifras que encuentre.
 */
export function toIsoDate(parsedDate?: string, rawDate?: string): string | undefined {
  for (const candidate of [parsedDate, rawDate]) {
    const m = /^\s*(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?!\d)/.exec(candidate ?? "");
    if (m) {
      const mm = m[2] && m[2] !== "0" && m[2] !== "00" ? m[2].padStart(2, "0") : "01";
      const dd = m[3] && m[3] !== "0" && m[3] !== "00" ? m[3].padStart(2, "0") : "01";
      return `${m[1]}-${mm}-${dd}`;
    }
  }
  const year = /\b(\d{4})\b/.exec(rawDate ?? "");
  return year ? `${year[1]}-01-01` : undefined;
}

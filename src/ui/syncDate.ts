const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const two = (n: number): string => String(n).padStart(2, "0");

/** «2026, nov 08 01:48» en hora local, con meses abreviados escritos a mano (no depende de la configuración regional). */
export function formatSyncDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}, ${MONTHS[d.getMonth()]} ${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

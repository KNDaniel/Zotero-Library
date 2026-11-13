export interface LineDifference {
  line: number;
  actual: string | undefined;
  expected: string | undefined;
}

export interface Comparison {
  identical: boolean;
  /** Total de líneas distintas (puede ser mayor que `differences.length`) */
  total: number;
  differences: LineDifference[];
}

/** Compara dos textos línea a línea (ignora la diferencia entre CRLF y LF). */
export function compareText(actual: string, expected: string, max = 8): Comparison {
  const a = actual.replace(/\r\n/g, "\n").split("\n");
  const b = expected.replace(/\r\n/g, "\n").split("\n");
  const differences: LineDifference[] = [];
  let total = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      total++;
      if (differences.length < max) differences.push({ line: i + 1, actual: a[i], expected: b[i] });
    }
  }
  return { identical: total === 0, total, differences };
}

export function formatComparison(c: Comparison): string {
  if (c.identical) return "✅ Idéntico: la plantilla reproduce la nota byte a byte.";
  const lines = [`❌ ${c.total} línea(s) distintas. Primeras diferencias:`, ""];
  for (const d of c.differences) {
    lines.push(`Línea ${d.line}`, `  obtenido: ${JSON.stringify(d.actual)}`, `  esperado: ${JSON.stringify(d.expected)}`, "");
  }
  return lines.join("\n");
}

/** Claves de anotación (8 caracteres) que aparecen en las líneas distintas. */
export function annotationKeysIn(c: Comparison): string[] {
  const keys = new Set<string>();
  for (const d of c.differences) {
    for (const line of [d.actual, d.expected]) {
      if (!line) continue;
      for (const m of line.matchAll(/annotation=([A-Z0-9]{8})|^\^([A-Z0-9]{8})\s*$|<br> ([A-Z0-9]{8})\s*$/g)) {
        keys.add((m[1] ?? m[2] ?? m[3])!);
      }
    }
  }
  return [...keys];
}

import { ANY_FIELD, isVirtualField, resolveFieldName } from "./fields";
import { norm, romanToInt } from "./text";

export type Operator = "contains" | "equals" | "startsWith" | "empty" | "gt" | "gte" | "lt" | "lte" | "between";

export interface Condition {
  /** Campo canónico, nombre real de Zotero o "*" (cualquier campo) */
  field: string;
  op: Operator;
  value: string;
  /** Segundo extremo de un `between` */
  value2?: string;
  /** Invierte el resultado: «no contiene», «no vacío», «no es»… */
  negate: boolean;
}

/** Y y O son alternativos: un único interruptor para toda la consulta. */
export interface QuerySpec {
  mode: "and" | "or";
  conditions: Condition[];
}

export interface ParsedQuery {
  spec: QuerySpec;
  warnings: string[];
}

const RANGE_SEP = String.raw`(?:\.\.|-|–|—)`;

/** Siglo en números romanos -> años (XIX = 1801–1900). */
function centuryRange(n: number): [number, number] {
  return [(n - 1) * 100 + 1, n * 100];
}

type Parsed = Pick<Condition, "op" | "value" | "value2">;

/**
 * Interpreta valores de año: 1867, 1850-1900, >1990, XIX, XVIII-XIX, «siglo XIX».
 * Con `centuryMode` (campo @siglo) los números arábigos pequeños son siglos.
 */
export function parseYearValue(raw: string, centuryMode = false): Parsed | null {
  const hadPrefix = /^(siglo|s\.?)\s+/i.test(raw.trim());
  const v = raw.trim().replace(/^(siglo|s\.?)\s+/i, "");

  const cmp = /^(>=|<=|>|<)\s*(\d{1,4})$/.exec(v);
  if (cmp) return { op: ({ ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" } as const)[cmp[1] as ">" | ">=" | "<" | "<="], value: cmp[2] };

  const arabicRange = new RegExp(String.raw`^(\d{1,4})\s*${RANGE_SEP}\s*(\d{1,4})$`).exec(v);
  if (arabicRange) return { op: "between", value: arabicRange[1], value2: arabicRange[2] };

  const romanRange = new RegExp(String.raw`^([ivxlcdm]+)\s*${RANGE_SEP}\s*([ivxlcdm]+)$`, "i").exec(v);
  if (romanRange) {
    const a = romanToInt(romanRange[1]);
    const b = romanToInt(romanRange[2]);
    if (a && b && a <= 30 && b <= 30) return { op: "between", value: String(centuryRange(a)[0]), value2: String(centuryRange(b)[1]) };
    return null;
  }

  const roman = romanToInt(v);
  if (roman !== null) {
    if (roman < 1 || roman > 30) return null;
    const [from, to] = centuryRange(roman);
    return { op: "between", value: String(from), value2: String(to) };
  }

  if (/^\d{1,4}$/.test(v)) {
    const n = Number(v);
    if ((centuryMode || hadPrefix) && n >= 1 && n <= 30) {
      const [from, to] = centuryRange(n);
      return { op: "between", value: String(from), value2: String(to) };
    }
    return { op: "equals", value: String(n) };
  }
  return null;
}

/** Comparadores y rangos genéricos (volumen, fechas ISO…): >2000, <=10, a..b */
function parseGenericValue(v: string): Parsed | null {
  const cmp = /^(>=|<=|>|<)\s*(.+)$/.exec(v);
  if (cmp) return { op: ({ ">": "gt", ">=": "gte", "<": "lt", "<=": "lte" } as const)[cmp[1] as ">" | ">=" | "<" | "<="], value: cmp[2].trim() };
  const range = /^(.+?)\s*\.\.\s*(.+)$/.exec(v);
  if (range) return { op: "between", value: range[1].trim(), value2: range[2].trim() };
  return null;
}

const isQuoted = (s: string) => s.length >= 2 && s.startsWith('"') && s.endsWith('"');
const unquote = (s: string) => (isQuoted(s) ? s.slice(1, -1) : s);

/**
 * Búsqueda rápida. Los términos se separan con `|` y se combinan según el
 * interruptor Y/O (`mode`):
 *   Marx                  texto en cualquier campo
 *   @autor: Marx          campo concreto (alias en español o nombre de Zotero)
 *   @año: 1867 | 1850-1900 | >1990 | XIX
 *   @campo: "texto"       coincidencia exacta
 *   @campo:               el campo tiene algún valor
 *   -término              negación (también -@autor: Engels)
 * `knownFields` (nombres de campo normalizados) permite avisar de campos inexistentes.
 */
export function parseQuery(text: string, mode: "and" | "or" = "and", knownFields?: Set<string>): ParsedQuery {
  const conditions: Condition[] = [];
  const warnings: string[] = [];

  for (const rawTerm of text.split("|")) {
    let t = rawTerm.trim();
    if (!t) continue;
    let negate = false;
    if (t.startsWith("-") && t.length > 1) {
      negate = true;
      t = t.slice(1).trim();
    }

    const m = /^@([\p{L}\p{N}_]+)\s*:\s*(.*)$/su.exec(t);
    if (!m) {
      conditions.push({ field: ANY_FIELD, op: "contains", value: unquote(t), negate });
      continue;
    }

    const canonical = resolveFieldName(m[1]);
    const value = m[2].trim();
    if (knownFields && !isVirtualField(canonical) && !knownFields.has(norm(canonical))) {
      warnings.push(`El campo «${m[1]}» no existe en tu biblioteca.`);
    }

    if (value === "") {
      // «@campo:» = el campo tiene algún valor
      conditions.push({ field: canonical === "century" ? "year" : canonical, op: "empty", value: "", negate: !negate });
      continue;
    }

    if (canonical === "year" || canonical === "century") {
      const parsed = parseYearValue(value, canonical === "century");
      if (parsed) {
        conditions.push({ field: "year", ...parsed, negate });
      } else {
        warnings.push(`No entiendo «${value}» como año o siglo; se busca como texto.`);
        conditions.push({ field: "year", op: "contains", value, negate });
      }
      continue;
    }

    if (isQuoted(value)) {
      conditions.push({ field: canonical, op: "equals", value: unquote(value), negate });
      continue;
    }
    const generic = parseGenericValue(value);
    conditions.push(generic ? { field: canonical, ...generic, negate } : { field: canonical, op: "contains", value, negate });
  }

  return { spec: { mode, conditions }, warnings };
}

import { ANY_FIELD, resolveFieldName } from "../filter/fields";
import type { Condition, Operator } from "../filter/query";

/** Operadores del modo complejo. «No contiene», «no es»… son el mismo operador negado. */
export interface OperatorDef {
  id: string;
  label: string;
  op: Operator;
  negate: boolean;
  /** Cuántos valores pide: 0, 1 o 2 (entre) */
  needs: 0 | 1 | 2;
}

export const OPERATORS: OperatorDef[] = [
  { id: "contains", label: "contiene", op: "contains", negate: false, needs: 1 },
  { id: "notcontains", label: "no contiene", op: "contains", negate: true, needs: 1 },
  { id: "equals", label: "es", op: "equals", negate: false, needs: 1 },
  { id: "notequals", label: "no es", op: "equals", negate: true, needs: 1 },
  { id: "startsWith", label: "empieza por", op: "startsWith", negate: false, needs: 1 },
  { id: "hasvalue", label: "tiene valor", op: "empty", negate: true, needs: 0 },
  { id: "empty", label: "está vacío", op: "empty", negate: false, needs: 0 },
  { id: "gt", label: ">", op: "gt", negate: false, needs: 1 },
  { id: "gte", label: "≥", op: "gte", negate: false, needs: 1 },
  { id: "lt", label: "<", op: "lt", negate: false, needs: 1 },
  { id: "lte", label: "≤", op: "lte", negate: false, needs: 1 },
  { id: "between", label: "entre", op: "between", negate: false, needs: 2 },
];

export const operatorById = (id: string): OperatorDef => OPERATORS.find((o) => o.id === id) ?? OPERATORS[0];

export function operatorOf(c: Condition): OperatorDef {
  return OPERATORS.find((o) => o.op === c.op && o.negate === c.negate) ?? OPERATORS[0];
}

/** Texto del campo escrito por el usuario -> campo canónico («año» -> year; vacío -> cualquier campo). */
export function fieldFromText(text: string): string {
  const t = text.trim();
  if (!t || t === "(cualquier campo)") return ANY_FIELD;
  const f = resolveFieldName(t);
  return f === "century" ? "year" : f;
}

export function emptyCondition(): Condition {
  return { field: ANY_FIELD, op: "contains", value: "", negate: false };
}

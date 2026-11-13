import type { ZoteroItem } from "../model/types";
import type { Condition, QuerySpec } from "./query";
import { ANY_FIELD, fieldValues, type EvalContext } from "./fields";
import { norm } from "./text";

/** Compara como números si ambos lo son; si no, como texto (vale para fechas ISO). */
function compare(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return a < b ? -1 : a > b ? 1 : 0;
}

function test(values: string[], c: Condition): boolean {
  const needle = norm(c.value);
  switch (c.op) {
    case "contains":
      return values.some((v) => norm(v).includes(needle));
    case "equals":
      return values.some((v) => norm(v) === needle);
    case "startsWith":
      return values.some((v) => norm(v).startsWith(needle));
    case "empty":
      return values.every((v) => v.trim() === "");
    case "gt":
      return values.some((v) => compare(v, c.value) > 0);
    case "gte":
      return values.some((v) => compare(v, c.value) >= 0);
    case "lt":
      return values.some((v) => compare(v, c.value) < 0);
    case "lte":
      return values.some((v) => compare(v, c.value) <= 0);
    case "between":
      return values.some((v) => compare(v, c.value) >= 0 && compare(v, c.value2 ?? c.value) <= 0);
  }
}

const COMPARING = new Set(["gt", "gte", "lt", "lte", "between"]);

export function conditionMatches(item: ZoteroItem, c: Condition, ctx: EvalContext): boolean {
  const values = fieldValues(item, c.field === "" ? ANY_FIELD : c.field, ctx, COMPARING.has(c.op));
  const result = test(values, c);
  return c.negate ? !result : result;
}

/** Sin condiciones, todos los ítems pasan. */
export function itemMatches(item: ZoteroItem, spec: QuerySpec, ctx: EvalContext): boolean {
  if (spec.conditions.length === 0) return true;
  return spec.mode === "and"
    ? spec.conditions.every((c) => conditionMatches(item, c, ctx))
    : spec.conditions.some((c) => conditionMatches(item, c, ctx));
}

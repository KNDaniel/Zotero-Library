import type { HttpClient } from "./http";

/** Prueba `primary`; si falla por red, reintenta con `secondary`. */
export function withFallback(primary: HttpClient, secondary: HttpClient): HttpClient {
  return async (req) => {
    try {
      return await primary(req);
    } catch (e1) {
      try {
        return await secondary(req);
      } catch (e2) {
        const m1 = (e1 as Error)?.message ?? String(e1);
        const m2 = (e2 as Error)?.message ?? String(e2);
        throw new Error(`${m1} · alternativa Node: ${m2}`);
      }
    }
  };
}

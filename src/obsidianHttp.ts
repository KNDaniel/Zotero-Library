import { requestUrl } from "obsidian";
import { trace } from "./log";
import type { HttpClient } from "./source/http";

const BIG = 1_000_000;

/**
 * requestUrl evita los problemas de CORS al hablar con localhost. El cuerpo se
 * decodifica SOLO cuando alguien lo pide y una vez (antes se leían `text` y
 * `json` siempre, duplicando el trabajo con respuestas de decenas de MB). Las
 * respuestas grandes o lentas se anotan en el registro para saber dónde se va el tiempo.
 */
export const obsidianHttp: HttpClient = async ({ url, headers }) => {
  const t0 = Date.now();
  const r = await requestUrl({ url, headers, throw: false });
  const waited = Date.now() - t0;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) lower[k.toLowerCase()] = v;

  const size = r.arrayBuffer?.byteLength ?? 0;
  const where = (() => {
    try {
      const u = new URL(url);
      return `${u.pathname}${u.search}`.slice(0, 90);
    } catch {
      return url.slice(0, 90);
    }
  })();
  if (size > BIG || waited > 3000) trace.log(`http ${where}: estado ${r.status}, ${(size / 1e6).toFixed(1)} MB, espera ${waited} ms`);
  const slow = (what: string, since: number) => {
    const ms = Date.now() - since;
    if (size > BIG || ms > 1000) trace.log(`http ${where}: ${what} en ${ms} ms`);
  };

  let text: string | undefined;
  let json: unknown;
  let jsonDone = false;
  return {
    status: r.status,
    headers: lower,
    get text(): string {
      if (text === undefined) {
        const t1 = Date.now();
        text = r.text;
        slow("decodificar texto", t1);
      }
      return text;
    },
    get json(): unknown {
      if (!jsonDone) {
        jsonDone = true;
        const t1 = Date.now();
        try {
          json = r.json;
        } catch {
          json = null;
        }
        slow("interpretar JSON", t1);
      }
      return json;
    },
  };
};

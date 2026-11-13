import * as http from "http";
import type { HttpClient } from "./source/http";

/**
 * Cliente HTTP basado en el módulo `http` de Node (el plugin es solo de
 * escritorio). No pasa por la pila de red de Chromium, así que no le afectan
 * sus proxies ni sus particularidades de cabeceras.
 */
export const nodeHttp: HttpClient = ({ url, headers }) =>
  new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { ...headers, Connection: "close" }, timeout: 15000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("error", reject);
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const lower: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) lower[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
        }
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, headers: lower, text, json });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });

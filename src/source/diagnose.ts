import type { HttpClient } from "./http";
import { ZOTERO_HEADERS } from "./LocalApiSource";

export interface Transport {
  name: string;
  http: HttpClient;
}

export interface Probe {
  transport: string;
  host: string;
  kind: "ping" | "api";
  url: string;
  /** Estado HTTP si hubo respuesta */
  status?: number;
  /** Error de red si no la hubo */
  error?: string;
}

export interface Diagnosis {
  probes: Probe[];
  workingBaseUrl?: string;
  workingTransport?: string;
  verdict: string;
}

const REFUSED = /ERR_CONNECTION_REFUSED|ECONNREFUSED/i;
const EMPTY = /ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ECONNRESET|socket hang up/i;
const TIMEOUT = /timeout|ERR_TIMED_OUT/i;

async function probe(
  t: Transport,
  host: string,
  kind: Probe["kind"],
  url: string,
  headers?: Record<string, string>,
): Promise<Probe> {
  try {
    const res = await t.http({ url, headers });
    return { transport: t.name, host, kind, url, status: res.status };
  } catch (e) {
    return { transport: t.name, host, kind, url, error: (e as Error)?.message ?? String(e) };
  }
}

/**
 * Prueba cada combinación de vía de red (requestUrl de Obsidian y Node http) y
 * de host (127.0.0.1 y localhost) y deduce la causa. Distingue:
 *  - «conexión rechazada»: nada escucha en el puerto (Zotero cerrado u otro puerto);
 *  - «respuesta vacía / conexión reiniciada»: algo escucha pero cierra sin contestar;
 *  - 403: Zotero responde con la API local desactivada;
 *  - funciona solo con una vía o un host concretos.
 */
export async function diagnoseConnection(
  transports: Transport[],
  baseUrl: string,
  libraryPath: string,
): Promise<Diagnosis> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { probes: [], verdict: `La URL «${baseUrl}» no es válida. Ejemplo: http://127.0.0.1:23119` };
  }
  const port = url.port || "23119";
  const hosts = [...new Set([url.hostname, "127.0.0.1", "localhost"])];
  const lib = libraryPath.replace(/^\/+|\/+$/g, "");
  const probes: Probe[] = [];

  for (const t of transports) {
    for (const host of hosts) {
      const root = `${url.protocol}//${host}:${port}`;
      probes.push(await probe(t, host, "ping", `${root}/connector/ping`, ZOTERO_HEADERS));
      probes.push(await probe(t, host, "api", `${root}/api/${lib}/items?limit=1`, ZOTERO_HEADERS));
    }
  }

  const working = probes.find((p) => p.kind === "api" && p.status === 200);
  if (working) {
    const root = `${url.protocol}//${working.host}:${port}`;
    const viaNode = working.transport !== transports[0]?.name;
    const parts = [`Funciona con ${root} usando ${working.transport}.`];
    if (working.host !== url.hostname) parts.push(`Cambia la URL de los ajustes a ${root}.`);
    if (viaNode) parts.push("El plugin usa esa vía automáticamente cuando la de Obsidian falla.");
    return { probes, workingBaseUrl: root, workingTransport: working.transport, verdict: parts.join(" ") };
  }

  const answered = probes.find((p) => p.status !== undefined);
  if (answered) {
    const api = probes.find((p) => p.kind === "api" && p.status !== undefined && p.host === answered.host);
    if (api?.status === 403) {
      return {
        probes,
        verdict:
          "Zotero está abierto, pero la API local está desactivada. Actívala en Zotero > Ajustes > Avanzado > «Permitir que otras aplicaciones de este equipo se comuniquen con Zotero», reinicia Zotero y reintenta.",
      };
    }
    if (api?.status === 404) {
      return {
        probes,
        verdict: "Zotero responde, pero no encuentra la biblioteca. Revisa la ruta (users/0) o actualiza a Zotero 7, que es el que incluye la API local.",
      };
    }
    return { probes, verdict: `Algo responde en el puerto ${port}, pero la API local devolvió el estado ${api?.status ?? "desconocido"}.` };
  }

  const errors = probes.map((p) => p.error ?? "");
  if (errors.every((e) => REFUSED.test(e))) {
    return {
      probes,
      verdict:
        `Nada escucha en el puerto ${port} (conexión rechazada en todas las pruebas). Causas probables: Zotero está cerrado, usa otro puerto, o el servidor local de Zotero está desactivado.`,
    };
  }
  if (errors.some((e) => EMPTY.test(e))) {
    return {
      probes,
      verdict:
        `Algo escucha en el puerto ${port}, pero cierra la conexión sin responder. Eso no es lo que hace Zotero cuando funciona. Causas probables: otro programa ocupa ese puerto, un antivirus o proxy intercepta el tráfico local, o Zotero está bloqueado. ` +
        "Comprueba qué proceso usa el puerto (en Windows: netstat -ano | findstr 23119, y luego tasklist /FI \"PID eq <número>\"), prueba http://127.0.0.1:23119/connector/ping en el navegador y reinicia Zotero.",
    };
  }
  if (errors.some((e) => TIMEOUT.test(e))) {
    return { probes, verdict: `La conexión al puerto ${port} se queda sin respuesta (tiempo agotado). Puede ser un cortafuegos o que Zotero esté bloqueado.` };
  }
  return { probes, verdict: "No se pudo conectar y los errores no encajan con un caso conocido; mira el detalle de cada prueba." };
}

export function renderDiagnosis(d: Diagnosis): string {
  const rows = d.probes.map(
    (p) =>
      `- ${p.transport} · ${p.host} · ${p.kind === "ping" ? "servidor" : "API local"}: ${
        p.status !== undefined ? `respuesta ${p.status}` : `sin respuesta (${p.error})`
      }`,
  );
  return ["# Diagnóstico de conexión con Zotero", "", `**${d.verdict}**`, "", ...rows, ""].join("\n");
}

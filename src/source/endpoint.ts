/** Valida el destino antes de que cualquier transporte envíe datos bibliográficos. */
export function validateZoteroBaseUrl(value: string, allowRemoteHost = false): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("La URL de Zotero no es válida. Usa, por ejemplo, http://127.0.0.1:23119.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("La URL de Zotero debe usar HTTP o HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new Error("La URL de Zotero no puede incluir credenciales, parámetros ni fragmentos.");
  if (url.pathname !== "/") throw new Error("La URL de Zotero debe apuntar al origen del servidor, sin una ruta adicional.");
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) throw new Error("El puerto de la URL de Zotero debe estar entre 1 y 65535.");

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isIpv4Loopback = /^127(?:\.\d{1,3}){3}$/.test(host) && host.split(".").every((part) => Number(part) <= 255);
  const isLoopback = host === "localhost" || host === "::1" || isIpv4Loopback;
  if (!isLoopback && !allowRemoteHost) throw new Error("Por seguridad, Zotero Library solo conecta con este equipo. Activa «Permitir servidor remoto» para confiar en otro host.");
  if (!isLoopback && url.protocol !== "https:") throw new Error("Los servidores remotos requieren HTTPS para proteger los datos bibliográficos en tránsito.");

  return url.origin;
}

export function validateLibraryPath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, "");
  if (!/^users\/(?:0|[1-9]\d*)$/.test(path) && !/^groups\/[1-9]\d*$/.test(path)) {
    throw new Error("La biblioteca debe tener el formato users/0 o groups/<id numérico>.");
  }
  return path;
}

import { isAbsolute } from "node:path";
import { hasControlCharacters } from "../vaultPaths";
import type { LibraryIndex } from "../index/LibraryIndex";
import { IMAGE_NAME_STRATEGIES, imageBaseName, imageParts } from "../model/imageName";
import { relatedItemKeys } from "../model/normalize";
import type { ZoteroAnnotation, ZoteroItem } from "../model/types";
import type { LocalApiSource } from "../source/LocalApiSource";
import { IMAGE_NAME_EXPECTATIONS } from "./expectations";

export type CheckStatus = "ok" | "warn" | "fail" | "info";

export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  details: string[];
  /** Omitida porque Zotero no está abierto (la conexión fue rechazada): no es un fallo de los datos */
  offline?: boolean;
}

export interface FsLike {
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
}

/** Cómo se cargó la biblioteca en esta sesión de Obsidian (no confundir con la última descarga completa). */
export interface SessionInfo {
  /** "cache": abierta desde la copia en disco; "download": descarga completa */
  origin?: "cache" | "download";
  ms?: number;
  cacheSavedAt?: number;
  lastSync?: { status: string; ms: number; at: number };
}

export interface VerifyOptions {
  source: LocalApiSource;
  index: LibraryIndex;
  fs: FsLike;
  dataDir: string;
  session?: SessionInfo;
  /** Estilos bibliográficos a probar (identificadores CSL) */
  styles?: string[];
}

export const DEFAULT_STYLES = ["apa", "chicago-author-date", "iso690-author-date-es", "iso690-numeric-es"];
const IMAGE_CHECK_CONCURRENCY = 8;

const code = (s: string) => `\`${s}\``;
const when = (t: number) => new Date(t).toLocaleString();
const SYNC_LABELS: Record<string, string> = {
  unchanged: "sin cambios",
  incremental: "incremental (solo lo modificado)",
  full: "recarga completa",
  offline: "sin conexión con Zotero",
  failed: "falló",
};
const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");
const joinPath = (...parts: string[]) => parts.join("/").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
const HTML_TAG = /<\/?(i|b|em|strong|sup|sub|u|br|span|p|a)\b[^>]*>/i;

/** Conexión rechazada: Zotero no está abierto (no confundir con la API desactivada, que sí es un fallo). */
const ZOTERO_CLOSED = /ERR_CONNECTION_REFUSED|ECONNREFUSED/i;

async function guard(
  id: string,
  title: string,
  fn: () => Promise<Omit<Check, "id" | "title">>,
  /** Qué contar de esta comprobación cuando Zotero está cerrado (por defecto, que se omite) */
  whenClosed?: () => string[],
): Promise<Check> {
  try {
    return { id, title, ...(await fn()) };
  } catch (e) {
    const err = e as Error & { hint?: string };
    if (ZOTERO_CLOSED.test(err.message)) {
      return { id, title, status: "info", offline: true, details: whenClosed?.() ?? ["Omitida: necesita Zotero abierto."] };
    }
    return { id, title, status: "fail", details: [`Error: ${err.message}`, ...(err.hint ? [err.hint] : [])] };
  }
}

/** Métricas de esta sesión de Obsidian. */
function sessionLines(session: SessionInfo | undefined): string[] {
  const lines: string[] = [];
  if (session?.origin === "cache") {
    lines.push(`Esta sesión: biblioteca abierta desde la copia en disco${session.cacheSavedAt ? ` (guardada el ${when(session.cacheSavedAt)})` : ""} en ${session.ms ?? "?"} ms.`);
  } else if (session?.origin === "download") {
    lines.push(`Esta sesión: descarga completa desde Zotero en ${session.ms ?? "?"} ms.`);
  } else {
    lines.push("Esta sesión: no hay registro de cómo se cargó la biblioteca.");
  }
  if (session?.lastSync) {
    const s = session.lastSync;
    lines.push(`Última sincronización de esta sesión (${when(s.at)}): ${SYNC_LABELS[s.status] ?? s.status}, ${s.ms} ms.`);
  } else {
    lines.push("Esta sesión: todavía no se ha sincronizado.");
  }
  return lines;
}

/** Métricas de la última descarga completa (se guardan en la copia en disco). */
function lastDownloadLines(index: LibraryIndex): string[] {
  const mode = index.fetchMode ? `${index.fetchMode === "unpaged" ? "en una sola respuesta" : "por páginas"}, ${index.requests} peticiones` : "";
  if (index.fetchedAt !== undefined) {
    return [`Última descarga completa (${when(index.fetchedAt)}): ${index.fetchMs ?? "?"} ms${mode ? `; ${mode}` : ""}.`];
  }
  return [`Última descarga completa: fecha y duración no registradas (la copia es anterior a la 0.6.1; se registrarán en la próxima descarga completa)${mode ? `; ${mode}` : ""}.`];
}

export async function runVerification(opts: VerifyOptions): Promise<Check[]> {
  const { source, index, fs, dataDir } = opts;
  const styles = opts.styles ?? DEFAULT_STYLES;
  const checks: Check[] = [];
  const annotations = [...index.annotations.values()];
  const itemsWithDate = [...index.items.values()].filter((i) => i.fields.date);

  checks.push(
    await guard("connection", "Conexión con la API local", async () => {
      const ping = await source.ping();
      const s = index.stats();
      return {
        status: "ok",
        details: [
          `Versión de la API: ${ping.apiVersion ?? "no informada"}; versión de la biblioteca: ${ping.libraryVersion}.`,
          `Cargado: ${s.items} ítems, ${s.attachments} adjuntos, ${s.notes} notas, ${s.annotations} anotaciones, ${s.collections} colecciones, ${s.annotationTags} etiquetas de anotaciones distintas.`,
          ...sessionLines(opts.session),
          ...lastDownloadLines(index),
        ],
      };
    }, () => {
      const s = index.stats();
      return [
        "Zotero no responde: no está abierto. El plugin trabaja con la copia de datos en disco.",
        `Cargado: ${s.items} ítems, ${s.attachments} adjuntos, ${s.notes} notas, ${s.annotations} anotaciones, ${s.collections} colecciones, ${s.annotationTags} etiquetas de anotaciones distintas.`,
        ...sessionLines(opts.session),
        ...lastDownloadLines(index),
      ];
    }),
  );

  checks.push(
    await guard("bulk-annotations", "Cómo llegan las anotaciones desde la API local", async () => {
      const labels: Record<string, string> = {
        items: "vienen en la lista general de ítems (/items)",
        "itemType-filter": "no vienen en /items; se obtuvieron filtrando por itemType=annotation",
        children: "no vienen en /items ni con el filtro; se obtuvieron pidiendo los hijos de cada adjunto",
        none: "no se obtuvieron por ninguna de las tres vías",
      };
      const details = [`Las anotaciones ${labels[index.annotationSource]}.`];
      if (index.annotationErrors) details.push(`Adjuntos cuyas anotaciones no se pudieron leer: ${index.annotationErrors}.`);
      const hasAnnotatable = [...index.attachments.values()].some((a) => /^(application\/pdf|application\/epub\+zip|text\/html)/i.test(a.contentType));
      if (index.annotationSource === "none" && hasAnnotatable) {
        return { status: "fail", details: [...details, "Hay PDF u otros adjuntos, pero ninguna anotación: hay que revisar cómo las entrega tu versión de Zotero."] };
      }
      const res = await source.getOk("/items", { itemType: "annotation", limit: 1 });
      const total = Number(res.headers["total-results"]);
      if (Number.isFinite(total)) {
        details.push(`Con el filtro itemType=annotation la API anuncia ${total}; el índice tiene ${index.annotations.size}.`);
        return { status: total === index.annotations.size ? "ok" : "warn", details };
      }
      return { status: index.annotationSource === "items" ? "ok" : "warn", details };
    }),
  );

  checks.push(
    await guard("colors", "Colores de anotación", async () => {
      const byHex = new Map<string, { n: number; cat: string; exact: boolean }>();
      for (const a of annotations) {
        const e = byHex.get(a.color) ?? { n: 0, cat: a.colorCategory, exact: a.colorExact };
        e.n++;
        byHex.set(a.color, e);
      }
      const rows = [...byHex.entries()].sort((x, y) => y[1].n - x[1].n);
      const odd = rows.filter(([, v]) => !v.exact);
      return {
        status: odd.length ? "warn" : "ok",
        details: [
          ...rows.map(([hex, v]) => `${code(hex || "(vacío)")} → ${v.cat || "?"}: ${v.n}${v.exact ? "" : " (no estándar, se asignó el más cercano)"}`),
          ...(odd.length ? ["Hay colores no estándar: conviene decidir cómo categorizarlos."] : []),
        ],
      };
    }),
  );

  checks.push(
    await guard("colors-origin", "Origen de los colores no estándar", async () => colorOrigin(index, annotations)),
  );

  checks.push(
    await guard("image-names", "Posición de anotaciones y nombres de imagen", async () => {
      const unparsable = index.diagnostics.unparsablePositions;
      const nonPdf = index.diagnostics.nonPdfPositions;
      const images = annotations.filter((a) => a.type === "image");
      const details = [
        `Anotaciones de tipo imagen: ${images.length}.`,
        `Anotaciones sin página (capturas web, EPUB…; llevan un selector en vez de rectángulos): ${nonPdf.length} de ${annotations.length}.`,
        `Anotaciones con posición ilegible: ${unparsable.length}.`,
      ];
      if (nonPdf.length) {
        const kinds = new Map<string, number>();
        for (const k of nonPdf) {
          const a = index.annotations.get(k)!;
          let t = "(desconocido)";
          try {
            t = String((JSON.parse(a.fields.annotationPosition ?? "") as { type?: string }).type ?? t);
          } catch {
            /* se queda como desconocido */
          }
          kinds.set(t, (kinds.get(t) ?? 0) + 1);
        }
        details.push(`Tipos de selector: ${[...kinds.entries()].map(([k, n]) => `${code(k)}: ${n}`).join(", ")}.`);
      }
      for (const k of unparsable.slice(0, 3)) details.push(`Posición ilegible ${k}: ${code(clip(index.annotations.get(k)!.fields.annotationPosition ?? "(sin campo)", 120))}`);
      const found = IMAGE_NAME_EXPECTATIONS.map((ex) => ({ ex, a: index.annotations.get(ex.annotationKey) })).filter(
        (x) => x.a,
      );
      let status: CheckStatus = "info";
      if (!found.length) {
        details.push("No encontré las anotaciones de referencia de la muestra sintética (ANN00001, ANN00002); no puedo confirmar la regla de nombres.");
      } else {
        const matching = IMAGE_NAME_STRATEGIES.filter((s) =>
          found.every(({ ex, a }) => {
            const p = imageParts(a!, s);
            return !!p && imageBaseName(a!.parentKey, p) === ex.expected;
          }),
        );
        if (matching.length) {
          status = "ok";
          details.push(`Reglas que reproducen los nombres de la muestra (${found.length} casos): ${matching.map((s) => code(s.id)).join(", ")}.`);
        } else {
          status = "fail";
          details.push("Ninguna regla probada reproduce los nombres de la muestra. Datos para ajustarla:");
        }
        for (const { ex, a } of found) {
          details.push(
            `${ex.annotationKey} (${ex.note}): esperado ${code(ex.expected)}; pageIndex=${a!.position?.pageIndex}, primer rectángulo=${JSON.stringify(a!.position?.rects[0])}.`,
          );
        }
      }
      for (const a of images.slice(0, 5)) {
        const p = imageParts(a);
        details.push(`Imagen ${a.key}: página ${a.pageLabel || "?"}, nombre propuesto ${p ? code(imageBaseName(a.parentKey, p)) : "(sin posición)"}.`);
      }
      return { status, details };
    }),
  );

  checks.push(
    await guard("html", "HTML dentro de texto y comentarios", async () => {
      const withText = annotations.filter((a) => HTML_TAG.test(a.text));
      const withComment = annotations.filter((a) => HTML_TAG.test(a.comment));
      const sample = [...withText.slice(0, 2).map((a) => `texto ${a.key}: ${code(clip(a.text, 100))}`), ...withComment.slice(0, 2).map((a) => `comentario ${a.key}: ${code(clip(a.comment, 100))}`)];
      return {
        status: "info",
        details: [
          `Anotaciones con etiquetas HTML en el texto subrayado: ${withText.length}; en el comentario: ${withComment.length}.`,
          ...(sample.length ? sample : ["No encontré etiquetas HTML en los datos que entrega la API."]),
          "Si tu nota tiene <i> o <sup> y aquí no aparecen, las añade Zotero Integration y hay que reproducirlo.",
        ],
      };
    }),
  );

  checks.push(
    await guard("dates", "Fechas", async () => {
      const noParsed = itemsWithDate.filter((i) => !i.parsedDate);
      const partial = itemsWithDate.filter((i) => i.parsedDate && i.parsedDate.length < 10);
      const sample = (list: ZoteroItem[]) => list.slice(0, 3).map((i) => `${code(i.fields.date)} → parsedDate ${code(i.parsedDate ?? "—")} → ${code(i.isoDate ?? "—")}`);
      return {
        status: noParsed.length ? "warn" : "ok",
        details: [
          `Ítems con fecha: ${itemsWithDate.length}; sin parsedDate: ${noParsed.length}; con fecha parcial: ${partial.length}.`,
          ...sample(partial),
          ...sample(noParsed),
        ],
      };
    }),
  );

  checks.push(
    await guard("relations", "Ítems relacionados", async () => {
      let withRel = 0;
      let resolved = 0;
      let missing = 0;
      for (const i of index.items.values()) {
        const keys = relatedItemKeys(i.relations);
        if (!keys.length) continue;
        withRel++;
        for (const k of keys) index.items.has(k) ? resolved++ : missing++;
      }
      return {
        status: missing ? "warn" : "info",
        details: [`Ítems con relaciones: ${withRel}; relaciones resueltas: ${resolved}; sin resolver: ${missing}.`],
      };
    }),
  );

  checks.push(
    await guard("files", "Archivos locales (carpeta de datos de Zotero)", async () => {
      const details: string[] = [`Carpeta de datos: ${code(dataDir)}.`];
      if (!isAbsolute(dataDir)) {
        return { status: "warn", details: [...details, "La ruta debe ser absoluta; corrígela en los ajustes. No se consultó el sistema de archivos."] };
      }
      if (!(await fs.exists(dataDir))) {
        return { status: "fail", details: [...details, "La carpeta no existe: corrígela en los ajustes."] };
      }
      const storage = joinPath(dataDir, "storage");
      const hasStorage = await fs.exists(storage);
      details.push(`storage: ${hasStorage ? "existe" : "no existe"}.`);

      const files = [...index.attachments.values()].filter((a) => a.linkMode === "imported_file" && a.filename).slice(0, 5);
      let present = 0;
      let unsafe = 0;
      for (const a of files) {
        // Zotero API metadata is external input. Restrict both path components
        // before asking the filesystem whether an attachment exists.
        if (!/^[A-Z0-9]{8}$/.test(a.key) || !a.filename || a.filename.includes("/") || a.filename.includes("\\") || hasControlCharacters(a.filename) || a.filename === "." || a.filename === "..") {
          unsafe++;
          continue;
        }
        if (await fs.exists(joinPath(storage, a.key, a.filename))) present++;
      }
      if (files.length) details.push(`Archivos de adjuntos importados encontrados: ${present} de ${files.length} comprobados.`);
      if (unsafe) details.push(`Se omitieron ${unsafe} rutas de adjuntos con componentes no válidos.`);

      const images = annotations.filter((a) => a.type === "image");
      const img = images[0];
      if (img) {
        const candidates = [joinPath(dataDir, "cache", "library", `${img.key}.png`), joinPath(dataDir, "cache", "groups", `${img.key}.png`)];
        const hits: string[] = [];
        for (const c of candidates) if (await fs.exists(c)) hits.push(c);
        details.push(
          hits.length
            ? `Caché de imagen de la anotación ${img.key}: encontrada en ${code(hits[0])}.`
            : `No encontré la imagen de la anotación ${img.key} en las rutas probadas.`,
        );
        const cacheDir = joinPath(dataDir, "cache");
        if (!hits.length && (await fs.exists(cacheDir))) {
          details.push(`Contenido de cache/: ${(await fs.readdir(cacheDir)).slice(0, 10).map(code).join(", ") || "(vacío)"}.`);
        }
        // Cuántas de todas las anotaciones de imagen tienen su PNG en la caché (Zotero lo genera al abrirlas en su lector)
        const pngFound = new Array<boolean>(images.length);
        let nextImage = 0;
        let imageCheckFailed = false;
        let imageCheckError: unknown;
        const checkImage = async (): Promise<void> => {
          while (!imageCheckFailed) {
            const i = nextImage++;
            if (i >= images.length) return;
            const a = images[i];
            try {
              pngFound[i] =
                (await fs.exists(joinPath(dataDir, "cache", "library", `${a.key}.png`))) ||
                (await fs.exists(joinPath(dataDir, "cache", "groups", `${a.key}.png`)));
            } catch (e) {
              imageCheckError = e;
              imageCheckFailed = true;
              return;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(IMAGE_CHECK_CONCURRENCY, images.length) }, () => checkImage()));
        if (imageCheckFailed) throw imageCheckError;
        const withPng = images.filter((_, i) => pngFound[i]).map((a) => a.key);
        const withoutPng = images.filter((_, i) => !pngFound[i]).map((a) => a.key);
        details.push(`Imágenes de anotaciones con PNG en la caché de Zotero: ${withPng.length} de ${images.length}.`);
        if (withoutPng.length) details.push(`Sin PNG (Zotero lo crea al abrir la anotación en su lector): ${withoutPng.slice(0, 10).map(code).join(", ")}${withoutPng.length > 10 ? ` y ${withoutPng.length - 10} más` : ""}.`);
      } else {
        details.push("No hay anotaciones de imagen para comprobar la caché de imágenes.");
      }
      return { status: hasStorage && (files.length === 0 || present === files.length) ? "ok" : "warn", details };
    }),
  );

  checks.push(
    await guard("bibliography", "Bibliografía formateada por Zotero", async () => {
      const sample = itemsWithDate[0] ?? [...index.items.values()][0];
      if (!sample) return { status: "info", details: ["No hay ítems para probar."] };
      const details: string[] = [`Ítem de prueba: ${sample.key}.`];
      let okCount = 0;
      for (const style of styles) {
        const res = await source.get(`/items/${sample.key}`, { format: "bib", style });
        const ok = res.status >= 200 && res.status < 300 && res.text.trim().length > 0;
        if (ok) okCount++;
        details.push(`${code(style)}: ${ok ? clip(res.text.replace(/<[^>]+>/g, " "), 160) : `no disponible (estado ${res.status})`}`);
      }
      const pair = [...index.items.values()].slice(0, 2).map((i) => i.key);
      if (pair.length === 2) {
        try {
          const r = await source.fetchBibliography(pair, styles[0]);
          details.push(`Bibliografía de varios ítems a la vez (itemKey): ${r.mode === "batch" ? "funciona, en una sola petición; el orden lo decide el estilo" : "no la admite tu Zotero; se pedirá ítem a ítem (más lento con muchos ítems)"}.`);
        } catch (e) {
          details.push(`Bibliografía de varios ítems: error (${(e as Error).message}).`);
        }
      }
      const inc = await source.get(`/items/${sample.key}`, { include: "bib", style: styles[0] });
      const json = inc.json as { bib?: unknown } | null;
      details.push(`include=bib con ${code(styles[0])}: ${json && typeof json.bib === "string" ? "funciona" : `no devuelve bib (estado ${inc.status})`}.`);
      return { status: okCount ? "ok" : "fail", details };
    }),
  );

  checks.push(
    await guard("fields", "Campos disponibles (para el filtro «cualquier campo»)", async () => {
      const details: string[] = [];
      const schema = await source.get("/itemFields", {}, "api");
      details.push(
        Array.isArray(schema.json)
          ? `/itemFields responde con ${schema.json.length} campos.`
          : `/itemFields no está disponible en la API local (estado ${schema.status}); se usarán los campos observados.`,
      );
      const byType = new Map<string, Set<string>>();
      const all = new Set<string>();
      for (const i of index.items.values()) {
        const set = byType.get(i.itemType) ?? new Set<string>();
        for (const k of Object.keys(i.fields)) {
          set.add(k);
          all.add(k);
        }
        byType.set(i.itemType, set);
      }
      details.push(`Campos distintos observados en ítems: ${all.size}, en ${byType.size} tipos de ítem.`);
      details.push(`<details><summary>Lista de campos observados</summary>${[...all].sort().map(code).join(", ")}</details>`);
      const annFields = new Set<string>();
      for (const a of annotations) Object.keys(a.fields).forEach((k) => annFields.add(k));
      details.push(`<details><summary>Campos observados en anotaciones (${annFields.size})</summary>${[...annFields].sort().map(code).join(", ")}</details>`);
      return { status: "info", details };
    }),
  );

  checks.push(
    await guard("sync", "Sincronización incremental (since y /deleted)", async () => {
      const v = index.libraryVersion;
      const st = index.stats();
      const total = st.items + st.attachments + st.notes + st.annotations;
      const count = async (since: number) => {
        const r = await source.getOk("/items", { since, limit: 1, includeTrashed: 1 });
        const n = Number(r.headers["total-results"]);
        return Number.isFinite(n) ? n : null;
      };
      const none = await count(v);
      const past = Math.max(0, v - 300);
      const some = await count(past);
      const del = await source.get("/deleted", { since: past });
      const delOk = del.status >= 200 && del.status < 300 && !!del.json && typeof del.json === "object";
      const details = [
        `Versión de la biblioteca: ${v}.`,
        `Con since=${v} (nada nuevo) la API devuelve ${none ?? "?"} elementos.`,
        `Con since=${past} devuelve ${some ?? "?"} de ${total}.`,
        `/deleted?since=${past}: ${delOk ? `funciona (${Object.entries(del.json as Record<string, unknown[]>).filter(([, a]) => Array.isArray(a) && a.length).map(([k, a]) => `${k}: ${a.length}`).join(", ") || "sin borrados"})` : `no disponible (estado ${del.status})`}.`,
      ];
      if (!delOk) {
        const keys = await source.fetchKeys("/items");
        if (keys && keys.size >= total * 0.9) {
          details.push(`format=keys devuelve ${keys.size} claves de ${total}.`);
          if (none !== null && none < total * 0.9) return { status: "ok", details: [...details, "Sin /deleted, los borrados se detectan comparando la lista de claves: la sincronización traerá solo los cambios."] };
        } else {
          details.push(`format=keys ${keys ? `devuelve solo ${keys.size} claves de ${total}` : "no está disponible"}.`);
        }
        return { status: "warn", details: [...details, "Sin /deleted ni lista de claves no se pueden detectar borrados: al sincronizar se recargará toda la biblioteca."] };
      }
      if (none === null || some === null) return { status: "warn", details: [...details, "La API no informa del total: no se puede comprobar `since`."] };
      if (none >= total * 0.9) return { status: "warn", details: [...details, "La API parece ignorar `since` y devolver todo: la sincronización funciona, pero no será más rápida."] };
      return { status: "ok", details: [...details, "`since` se respeta: la sincronización traerá solo los cambios."] };
    }),
  );

  checks.push(
    await guard("integrity", "Integridad de los datos", async () => {
      const d = index.diagnostics;
      const details = [
        `Adjuntos sin ítem padre (PDF sueltos): ${d.standaloneAttachments.length}, con ${d.annotationsOfStandalone.length} anotaciones.`,
        `Adjuntos huérfanos (padre ausente): ${d.orphanAttachments.length}, con ${d.orphanAttachments.reduce((n, k) => n + (index.attachments.get(k)?.annotationKeys.length ?? 0), 0)} anotaciones.`,
        `Anotaciones huérfanas (adjunto ausente): ${d.orphanAnnotations.length}.`,
        `Entidades que no se pudieron normalizar: ${d.failed.length}.`,
        ...d.failed.slice(0, 5).map((f) => `${f.key}: ${f.error}`),
      ];
      const seen = new Map<string, number>();
      for (const a of annotations) {
        const k = `${a.parentKey}|${a.sortIndex}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      const ties = [...seen.values()].filter((n) => n > 1).length;
      details.push(`Grupos de anotaciones con el mismo sortIndex en un adjunto: ${ties} (se desempatan por fecha de alta y clave).`);
      if (d.orphanAttachments.length) {
        const parents = new Set(d.orphanAttachments.map((k) => index.attachments.get(k)?.parentKey ?? ""));
        const trash = await source.get("/items/trash", { format: "keys" });
        if (trash.status >= 200 && trash.status < 300) {
          const keys = new Set(trash.text.match(/\b[A-Z0-9]{8}\b/g) ?? []);
          const inTrash = [...parents].filter((k) => keys.has(k)).length;
          details.push(`Padres ausentes: ${parents.size}; de ellos están en la papelera: ${inTrash}.`);
        } else {
          details.push(`Padres ausentes: ${parents.size}; no pude consultar la papelera (estado ${trash.status}).`);
        }
        details.push(`Ejemplos de padres ausentes: ${[...parents].slice(0, 5).map(code).join(", ")}.`);
      }
      const bad = d.failed.length > 0;
      const warn = d.orphanAttachments.length + d.orphanAnnotations.length > 0 || d.annotationsOfStandalone.length > 0;
      return { status: bad ? "fail" : warn ? "warn" : "ok", details };
    }),
  );

  // Un único aviso en vez de varios errores iguales cuando Zotero está cerrado.
  const skipped = checks.filter((c) => c.offline);
  if (skipped.length) {
    checks.unshift({
      id: "offline",
      title: "Zotero no está abierto",
      status: "info",
      details: [
        `Se omiten las comprobaciones que necesitan la API local (${skipped.length}): ${skipped.map((c) => c.title).join("; ")}.`,
        "El resto sale de la copia de datos en disco, que es lo que usa el plugin sin conexión. La bibliografía formateada solo se puede obtener con Zotero abierto.",
        "Para ejecutarlas, abre Zotero (con «Permitir que otras aplicaciones de este equipo se comuniquen con Zotero» activada) y vuelve a generar el informe.",
      ],
    });
  }
  return checks;
}

function tally<T>(list: T[], key: (x: T) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const day = (s: string) => s.slice(0, 10);

/**
 * Datos para averiguar de dónde salen los colores que no son de los ocho estándar:
 * ítem o PDF suelto, autor de la anotación, fechas de alta y adjuntos implicados.
 * No concluye nada: solo muestra la evidencia.
 */
function colorOrigin(index: LibraryIndex, annotations: ZoteroAnnotation[]): Omit<Check, "id" | "title"> {
  const odd = annotations.filter((a) => !a.colorExact);
  if (!odd.length) return { status: "ok", details: ["Todas las anotaciones usan los ocho colores estándar de Zotero."] };
  const standard = annotations.filter((a) => a.colorExact);
  const standalone = new Set(index.diagnostics.standaloneAttachments);
  const withAuthor = (l: ZoteroAnnotation[]) => l.filter((a) => a.authorName).length;
  const range = (l: ZoteroAnnotation[]) => {
    const d = l.map((a) => a.dateAdded).filter(Boolean).sort();
    return d.length ? `${day(d[0])} → ${day(d[d.length - 1])}` : "sin fechas";
  };
  const details = [
    `Anotaciones con color no estándar: ${odd.length} de ${annotations.length}.`,
    `Con annotationAuthorName relleno: ${withAuthor(odd)} de ${odd.length} no estándar y ${withAuthor(standard)} de ${standard.length} estándar. Si el campo solo viene relleno en las no estándar, apunta a anotaciones importadas de un PDF anotado con otro programa (hipótesis: esta lista sirve para confirmarlo o descartarlo).`,
    `Fechas de alta: no estándar ${range(odd)}; estándar ${range(standard)}.`,
  ];
  const mixedCache = new Map<string, boolean>();
  const hasStandard = (parentKey: string): boolean => {
    if (!mixedCache.has(parentKey)) {
      const att = index.attachments.get(parentKey);
      mixedCache.set(parentKey, !!att && att.annotationKeys.some((k) => index.annotations.get(k)?.colorExact));
    }
    return mixedCache.get(parentKey)!;
  };
  const byHex = new Map<string, ZoteroAnnotation[]>();
  for (const a of odd) byHex.set(a.color, [...(byHex.get(a.color) ?? []), a]);
  for (const [hex, list] of [...byHex.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const inStandalone = list.filter((a) => standalone.has(a.parentKey)).length;
    const authors = tally(list, (a) => a.authorName || "(vacío)").slice(0, 4).map(([k, n]) => `${code(k)}: ${n}`).join(", ");
    const types = tally(list, (a) => a.type || "?").map(([k, n]) => `${k}: ${n}`).join(", ");
    const parents = tally(list, (a) => a.parentKey);
    const mixed = parents.filter(([k]) => hasStandard(k)).length;
    details.push(`${code(hex)} (${list.length}, más cercano: ${list[0].colorCategory}): tipos ${types}; en PDF de un ítem: ${list.length - inStandalone}, en PDF suelto: ${inStandalone}; fechas ${range(list)}; autores ${authors}; adjuntos implicados: ${parents.length}, de ellos con anotaciones de color estándar también: ${mixed}.`);
    for (const [pk, n] of parents.slice(0, 3)) {
      const att = index.attachments.get(pk);
      const itemKey = att?.parentKey ?? null;
      const title = itemKey ? index.items.get(itemKey)?.title || "(sin título)" : "(PDF suelto)";
      details.push(`  ${code(hex)} en ${code(att?.filename || att?.title || pk)} — ${clip(title, 80)}: ${n}.`);
    }
  }
  return { status: "warn", details };
}

const ICON: Record<CheckStatus, string> = { ok: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };

export function renderReport(checks: Check[], meta: { date: string; pluginVersion: string }): string {
  const lines = [
    "# Zotero Library — informe de verificación",
    "",
    `Generado: ${meta.date} · plugin ${meta.pluginVersion}`,
    "",
    "Resumen: " + (["ok", "warn", "fail", "info"] as CheckStatus[]).map((s) => `${ICON[s]} ${checks.filter((c) => c.status === s).length}`).join(" · "),
    "",
  ];
  for (const c of checks) {
    lines.push(`## ${ICON[c.status]} ${c.title}`, "");
    for (const d of c.details) lines.push(d.startsWith("<details>") ? d : d.startsWith("  ") ? `  - ${d.trim()}` : `- ${d}`);
    lines.push("");
  }
  return lines.join("\n");
}

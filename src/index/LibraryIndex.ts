import { normalizeCollection, normalizeEntity, relatedItemKeys } from "../model/normalize";
import { attachmentAsItem } from "../model/attachmentItem";
import type {
  ZoteroAnnotation,
  ZoteroAttachment,
  ZoteroCollection,
  ZoteroItem,
  ZoteroNote,
} from "../model/types";
import type { AnnotationSource, RawLibrary } from "../source/ZoteroSource";

export interface Diagnostics {
  /** Adjuntos cuyo ítem padre no está en la biblioteca cargada */
  orphanAttachments: string[];
  /** Anotaciones cuyo adjunto no está en la biblioteca cargada */
  orphanAnnotations: string[];
  /** Adjuntos sin ítem padre (PDF sueltos) */
  standaloneAttachments: string[];
  /** Anotaciones que pertenecen a un adjunto suelto */
  annotationsOfStandalone: string[];
  /** Anotaciones con un color que no es uno de los ocho estándar */
  nonStandardColors: string[];
  /** Anotaciones con posición válida pero sin página (capturas web, EPUB): llevan un selector */
  nonPdfPositions: string[];
  /** Anotaciones cuya posición no es un JSON legible */
  unparsablePositions: string[];
  /** Entidades que no se pudieron normalizar */
  failed: Array<{ key: string; error: string }>;
}

export interface IndexStats {
  items: number;
  attachments: number;
  notes: number;
  annotations: number;
  collections: number;
  annotationTags: number;
  libraryVersion: number;
}

const byKey = <T extends { key: string }>(a: T, b: T) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
/** Por fecha de alta (más antigua primero) y, a igualdad, por clave. */
const byAdded = (a: { dateAdded: string; key: string }, b: { dateAdded: string; key: string }) =>
  a.dateAdded < b.dateAdded ? -1 : a.dateAdded > b.dateAdded ? 1 : byKey(a, b);

/**
 * Índice en memoria de la biblioteca. Los filtros del plugin se aplican sobre
 * este índice, no contra la API.
 */
export class LibraryIndex {
  /** Adjuntos sin contenedor (sueltos o con padre ausente) vistos como ítems sintéticos, por clave del adjunto */
  readonly attachmentItems = new Map<string, ZoteroItem>();
  readonly items = new Map<string, ZoteroItem>();
  readonly attachments = new Map<string, ZoteroAttachment>();
  readonly notes = new Map<string, ZoteroNote>();
  readonly annotations = new Map<string, ZoteroAnnotation>();
  readonly collections = new Map<string, ZoteroCollection>();
  readonly diagnostics: Diagnostics = {
    orphanAttachments: [],
    orphanAnnotations: [],
    standaloneAttachments: [],
    annotationsOfStandalone: [],
    nonStandardColors: [],
    nonPdfPositions: [],
    unparsablePositions: [],
    failed: [],
  };
  libraryVersion = 0;
  loadedAt = 0;
  annotationSource: AnnotationSource = "items";
  annotationErrors = 0;
  fetchMode: "unpaged" | "paged" | undefined;
  requests = 0;
  /** Última descarga completa: cuándo terminó y cuánto tardó (undefined en copias anteriores a la 0.6.1) */
  fetchedAt: number | undefined;
  fetchMs: number | undefined;

  static fromRaw(raw: RawLibrary): LibraryIndex {
    const index = new LibraryIndex();
    index.libraryVersion = raw.libraryVersion;
    index.annotationSource = raw.annotationSource ?? "items";
    index.annotationErrors = raw.annotationErrors ?? 0;
    index.fetchMode = raw.fetchMode;
    index.requests = raw.requests ?? 0;
    index.fetchedAt = raw.fetchedAt;
    index.fetchMs = raw.fetchMs;
    index.loadedAt = Date.now();

    for (const obj of raw.collections) {
      try {
        const c = normalizeCollection(obj);
        index.collections.set(c.key, c);
      } catch (e) {
        index.diagnostics.failed.push({ key: obj?.key ?? "?", error: (e as Error).message });
      }
    }

    for (const obj of raw.entities) {
      try {
        const e = normalizeEntity(obj);
        if (e.kind === "item") index.items.set(e.key, e);
        else if (e.kind === "attachment") index.attachments.set(e.key, e);
        else if (e.kind === "note") index.notes.set(e.key, e);
        else index.annotations.set(e.key, e);
      } catch (err) {
        index.diagnostics.failed.push({ key: obj?.key ?? "?", error: (err as Error).message });
      }
    }

    index.link();
    return index;
  }

  /** Resuelve una sola vez las relaciones nota/adjunto -> ítem y anotación -> adjunto. */
  private link(): void {
    const d = this.diagnostics;

    // Orden de los adjuntos de un ítem: por fecha de alta y, a igualdad, por clave.
    for (const at of [...this.attachments.values()].sort(byAdded)) {
      if (!at.parentKey) {
        d.standaloneAttachments.push(at.key);
        this.attachmentItems.set(at.key, attachmentAsItem(at));
        continue;
      }
      const parent = this.items.get(at.parentKey);
      if (parent) parent.attachmentKeys.push(at.key);
      else {
        d.orphanAttachments.push(at.key);
        this.attachmentItems.set(at.key, attachmentAsItem(at));
      }
    }

    for (const note of [...this.notes.values()].sort(byKey)) {
      if (note.parentKey) this.items.get(note.parentKey)?.noteKeys.push(note.key);
    }

    for (const an of this.annotations.values()) {
      const at = this.attachments.get(an.parentKey);
      if (!at) {
        d.orphanAnnotations.push(an.key);
        continue;
      }
      at.annotationKeys.push(an.key);
      if (!at.parentKey) d.annotationsOfStandalone.push(an.key);
      if (!an.colorExact) d.nonStandardColors.push(an.key);
      if (!an.position) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(an.fields.annotationPosition ?? "");
        } catch {
          parsed = null;
        }
        (typeof parsed === "object" && parsed !== null ? d.nonPdfPositions : d.unparsablePositions).push(an.key);
      }
    }

    // Orden de lectura dentro de cada adjunto: sortIndex de Zotero. Si dos anotaciones
    // empatan (mismo sortIndex), Zotero las deja en orden de creación: primero la más
    // antigua (fecha de alta) y, a igualdad, por clave.
    for (const at of this.attachments.values()) {
      at.annotationKeys.sort((a, b) => {
        const x = this.annotations.get(a)!;
        const y = this.annotations.get(b)!;
        if (x.sortIndex !== y.sortIndex) return x.sortIndex < y.sortIndex ? -1 : 1;
        return byAdded(x, y);
      });
    }
  }

  attachmentsOf(itemKey: string): ZoteroAttachment[] {
    const item = this.items.get(itemKey);
    if (item) return item.attachmentKeys.map((k) => this.attachments.get(k)!).filter(Boolean);
    const standalone = this.attachments.get(itemKey);
    return standalone ? [standalone] : [];
  }

  /** Anotaciones de un ítem (de todos sus adjuntos), en orden de lectura. */
  annotationsOf(itemKey: string): ZoteroAnnotation[] {
    const out: ZoteroAnnotation[] = [];
    for (const at of this.attachmentsOf(itemKey)) {
      for (const k of at.annotationKeys) {
        const a = this.annotations.get(k);
        if (a) out.push(a);
      }
    }
    return out;
  }

  /** Clave del ítem al que pertenece una anotación (o la del adjunto si no tiene ítem: PDF suelto o padre ausente). */
  itemKeyOf(annotation: ZoteroAnnotation): string | null {
    const at = this.attachments.get(annotation.parentKey);
    if (!at) return null;
    return at.parentKey && this.items.has(at.parentKey) ? at.parentKey : at.key;
  }

  /** Un ítem real o, si la clave es la de un adjunto sin contenedor, su ítem sintético. */
  entry(key: string): ZoteroItem | undefined {
    return this.items.get(key) ?? this.attachmentItems.get(key);
  }

  relatedItems(item: ZoteroItem): ZoteroItem[] {
    return relatedItemKeys(item.relations)
      .map((k) => this.items.get(k))
      .filter((i): i is ZoteroItem => !!i);
  }

  /** Una colección y todas sus descendientes. */
  collectionWithDescendants(key: string): Set<string> {
    const out = new Set<string>();
    if (!this.collections.has(key)) return out;
    const children = new Map<string, string[]>();
    for (const c of this.collections.values()) {
      if (c.parentKey) children.set(c.parentKey, [...(children.get(c.parentKey) ?? []), c.key]);
    }
    const stack = [key];
    while (stack.length) {
      const k = stack.pop()!;
      if (out.has(k)) continue; // protege de ciclos
      out.add(k);
      stack.push(...(children.get(k) ?? []));
    }
    return out;
  }

  /** Ítems que pertenecen a alguna de las colecciones dadas. */
  itemKeysInCollections(collectionKeys: Iterable<string>, includeSubcollections: boolean): Set<string> {
    const wanted = new Set<string>();
    for (const k of collectionKeys) {
      if (includeSubcollections) this.collectionWithDescendants(k).forEach((x) => wanted.add(x));
      else wanted.add(k);
    }
    const out = new Set<string>();
    for (const item of [...this.items.values(), ...this.attachmentItems.values()]) {
      if (item.collections.some((c) => wanted.has(c))) out.add(item.key);
    }
    return out;
  }

  /** Etiquetas de anotaciones con su recuento (de las anotaciones dadas, o de todas). */
  annotationTagCounts(annotations: Iterable<ZoteroAnnotation> = this.annotations.values()): Map<string, number> {
    const counts = new Map<string, number>();
    for (const a of annotations) {
      for (const t of new Set(a.tags.map((x) => x.tag))) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }

  /** Reconstruye la descarga cruda (para guardar la copia en disco o mezclar cambios). */
  toRaw(): RawLibrary {
    const entities = [...this.items.values(), ...this.attachments.values(), ...this.notes.values(), ...this.annotations.values()].map((e) => e.raw);
    return {
      entities,
      collections: [...this.collections.values()].map((c) => c.raw),
      libraryVersion: this.libraryVersion,
      total: entities.length,
      truncated: false,
      annotationSource: this.annotationSource,
      annotationErrors: this.annotationErrors,
      fetchMode: this.fetchMode,
      requests: this.requests,
      fetchedAt: this.fetchedAt,
      fetchMs: this.fetchMs,
    };
  }

  stats(): IndexStats {
    return {
      items: this.items.size,
      attachments: this.attachments.size,
      notes: this.notes.size,
      annotations: this.annotations.size,
      collections: this.collections.size,
      annotationTags: this.annotationTagCounts().size,
      libraryVersion: this.libraryVersion,
    };
  }
}

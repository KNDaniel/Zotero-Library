import type { LibraryIndex } from "../index/LibraryIndex";
import type { ZoteroAnnotation, ZoteroItem } from "../model/types";
import { itemContext, standaloneAnnotationContext, type ContextOptions } from "../template/context";
import { DEFAULT_PRINT_ANNOTATIONS, DEFAULT_PRINT_FULL, DEFAULT_PRINT_META } from "../template/defaults";
import { DEFAULT_LINK_TEMPLATE, linkTemplateById } from "../template/linkTemplates";
import type { TemplateEngine } from "../template/engine";
import { stripFrontmatter, type PreviewImage } from "../markdown";
import type { Derived } from "../ui/state";

/** Qué se saca: la nota completa de cada ítem, solo su metadata, solo las anotaciones, la bibliografía o un enlace Markdown. */
export type OutputKind = "full" | "meta" | "annotations" | "bibliography" | "link";

export const OUTPUT_KINDS: Array<{ value: OutputKind; label: string }> = [
  { value: "full", label: "Metadata + anotaciones" },
  { value: "meta", label: "Solo metadata" },
  { value: "annotations", label: "Solo anotaciones" },
  { value: "bibliography", label: "Bibliografía" },
  { value: "link", label: "Enlace Markdown" },
];

export interface OutputRequest {
  kind: OutputKind;
  /** Modo de la vista; con «Enlace Markdown» decide si se sacan enlaces de ítems o de anotaciones (por defecto, ítems) */
  mode?: "item" | "annotation";
  /** Plantilla elegida para esta salida; vacío = la de los ajustes (o la incluida) */
  template: string;
  /** Estilo CSL; vacío = el de los ajustes */
  style: string;
}

/**
 * Todo el resultado, un único ítem o una única anotación (botones de cada tarjeta), o las
 * tarjetas marcadas. Las marcas son de un modo: en modo Ítems, ítems; en modo Anotaciones,
 * anotaciones (y su ítem aparece con solo las anotaciones marcadas).
 */
export type OutputScope =
  | { type: "all" }
  | { type: "item"; key: string }
  | { type: "annotation"; key: string }
  | { type: "marked"; mode: "item" | "annotation"; items: string[]; annotations: string[] };

export interface OutputSettings {
  /** Plantilla por defecto de cada tipo de salida (de los ajustes) */
  defaultTemplates: Record<OutputKind, string>;
  defaultStyle: string;
  /** Con varios ítems, quita el YAML inicial de cada nota para poder juntarlas */
  stripFrontmatterMulti: boolean;
  /** Encabezado con el nombre del grupo cuando los resultados están agrupados */
  groupHeaders: boolean;
}

export interface BuildDeps {
  index: LibraryIndex;
  engine: TemplateEngine;
  templates: Map<string, string>;
  opts: ContextOptions;
  settings: OutputSettings;
  fetchBibliography(keys: string[], style: string): Promise<{ entries: string[]; failed: string[] }>;
}

export interface BuiltOutput {
  text: string;
  /** Imágenes que el texto referencia (hay que copiarlas al vault) */
  images: PreviewImage[];
  items: number;
  annotations: number;
  warnings: string[];
  /** Nombre de la plantilla usada */
  template: string;
  /** De qué trata la nota: de ítems o de anotaciones (decide la plantilla del nombre de la nota nueva) */
  entity: "item" | "annotation";
  /** Variables del único ítem o anotación de la salida; null si hay varios o ninguno */
  single: Record<string, unknown> | null;
  /** Clave de Zotero de ese único ítem o anotación */
  singleKey: string | null;
}

const BUILTIN: Record<OutputKind, string> = {
  full: DEFAULT_PRINT_FULL,
  meta: DEFAULT_PRINT_META,
  annotations: DEFAULT_PRINT_ANNOTATIONS,
  bibliography: "",
  link: DEFAULT_LINK_TEMPLATE.item,
};

/** Plantilla elegida > plantilla por defecto de los ajustes > plantilla incluida. */
export function resolveTemplate(
  kind: OutputKind,
  override: string,
  defaults: Record<OutputKind, string>,
  templates: Map<string, string>,
  /** Solo «Enlace Markdown»: la versión para anotaciones de las plantillas incluidas */
  perAnnotation = false,
): { name: string; source: string; builtin: boolean; missing?: string } {
  const wanted = override || defaults[kind];
  if (kind === "link") {
    // Las plantillas incluidas del enlace tienen nombre propio y una versión para ítems y otra para anotaciones
    const inc = linkTemplateById(wanted);
    if (inc) return { name: inc.label, source: perAnnotation ? inc.annotation : inc.item, builtin: true };
    const own = wanted ? templates.get(wanted) : undefined;
    if (own !== undefined) return { name: wanted, source: own, builtin: false };
    const def = DEFAULT_LINK_TEMPLATE;
    return { name: def.label, source: perAnnotation ? def.annotation : def.item, builtin: true, ...(wanted ? { missing: wanted } : {}) };
  }
  if (wanted) {
    const source = templates.get(wanted);
    if (source !== undefined) return { name: wanted, source, builtin: false };
    return { name: "(incluida)", source: BUILTIN[kind], builtin: true, missing: wanted };
  }
  return { name: "(incluida)", source: BUILTIN[kind], builtin: true };
}

const imagesOf = (list: Array<Record<string, unknown>>): PreviewImage[] =>
  list
    .filter((a) => a.imageRelativePath && a.imagePath)
    .map((a) => ({ relativePath: String(a.imageRelativePath), absolutePath: String(a.imagePath), key: String(a.id ?? "") }));

/**
 * Junta varias piezas con una línea en blanco entre ellas. Una sola pieza se
 * entrega exactamente como la produce la plantilla (tu nota, byte a byte).
 */
export function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.map((p) => p.replace(/\s+$/, "")).join("\n\n")}\n`;
}

const unique = <T extends { key: string }>(list: T[]): T[] => {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
};

/**
 * Compone el texto de una salida a partir de lo que muestra la vista (mismo
 * orden, mismos filtros de etiquetas). Con un solo ítem, el resultado de la
 * plantilla se entrega tal cual: tu plantilla de importación produce tu nota.
 */
export async function buildOutput(d: Derived, request: OutputRequest, scope: OutputScope, deps: BuildDeps): Promise<BuiltOutput> {
  const { index, engine, opts, settings } = deps;
  const warnings: string[] = [];
  const kind: OutputKind = scope.type === "annotation" && request.kind !== "link" ? "annotations" : request.kind;
  const marked = scope.type === "marked" ? scope : null;
  // «Enlace Markdown»: una anotación, las marcadas en modo anotaciones o, en general, el modo de la vista decide si salen enlaces de anotaciones
  const linkAnnotations = kind === "link" && (scope.type === "annotation" || (marked ? marked.mode === "annotation" : request.mode === "annotation"));
  const tpl = resolveTemplate(kind, request.template, settings.defaultTemplates, deps.templates, linkAnnotations);
  if (tpl.missing) warnings.push(`No encuentro la plantilla «${tpl.missing}»: se usa la incluida.`);

  // Ítems del alcance, en el orden mostrado y sin repetir (agrupar por colección puede repetirlos)
  let items: ZoteroItem[] = unique(d.itemGroups.flatMap((g) => g.entries));
  if (scope.type === "item") items = items.filter((i) => i.key === scope.key);
  const markedItems = new Set(marked?.items ?? []);
  const markedAnnotations = new Set(marked?.annotations ?? []);
  if (marked?.mode === "item") {
    items = items.filter((i) => markedItems.has(i.key));
  } else if (marked) {
    // Modo anotaciones: los ítems que tienen alguna anotación marcada (se vea o no con los filtros actuales)
    const owners = new Set(d.markedAnnotationList.filter((a) => markedAnnotations.has(a.key)).map((a) => index.itemKeyOf(a)));
    items = items.filter((i) => owners.has(i.key));
  }

  const images: PreviewImage[] = [];
  let text = "";
  let annotationCount = 0;
  const entity: "item" | "annotation" = kind === "annotations" || linkAnnotations ? "annotation" : "item";
  let single: Record<string, unknown> | null = null;
  let singleKey: string | null = null;

  if (kind === "full" || kind === "meta") {
    let onlyCtx: Record<string, unknown> | null = null;
    const onlyItem = items.length === 1 ? items[0] : undefined;
    let texts = items.map((item) => {
      let shown = d.results.annotations.get(item.key) ?? [];
      // En modo anotaciones, el ítem lleva solo las anotaciones marcadas (también las que los filtros ocultan)
      if (marked?.mode === "annotation") shown = d.markedAnnotationList.filter((a) => markedAnnotations.has(a.key) && index.itemKeyOf(a) === item.key);
      const ctx = itemContext(index, item, shown, d.results.allAnnotations.get(item.key) ?? [], opts);
      images.push(...imagesOf(ctx.annotations as Array<Record<string, unknown>>));
      annotationCount += (ctx.annotations as unknown[]).length;
      onlyCtx = ctx;
      return engine.render(tpl.source, ctx, tpl.name);
    });
    if (onlyItem) {
      single = onlyCtx;
      singleKey = onlyItem.key;
    }
    if (items.length > 1 && settings.stripFrontmatterMulti) texts = texts.map(stripFrontmatter);
    text = joinParts(texts);
  } else if (kind === "link" && !linkAnnotations) {
    // Un enlace por ítem, en el orden mostrado y uno por línea
    const lines = items.map((item) => engine.render(tpl.source, itemContext(index, item, [], [], opts), tpl.name).trim());
    text = lines.join("\n");
    const onlyItem = items.length === 1 ? items[0] : undefined;
    if (onlyItem) {
      single = itemContext(index, onlyItem, [], [], opts);
      singleKey = onlyItem.key;
    }
  } else if (kind === "annotations" || kind === "link") {
    const position = new Map<string, number>();
    // La numeración es la de la vista; con marcas, la de la lista que incluye las marcadas que los filtros ocultan.
    (marked?.mode === "annotation" ? d.annotationsPlusMarked : d.annotations).forEach((a, i) => position.set(a.key, i + 1));
    let groups: Array<{ label: string; entries: ZoteroAnnotation[] }>;
    if (scope.type === "annotation") {
      const a = index.annotations.get(scope.key);
      groups = a ? [{ label: "", entries: [a] }] : [];
    } else if (scope.type === "item") {
      groups = [{ label: "", entries: d.annotations.filter((a) => index.itemKeyOf(a) === scope.key) }];
    } else if (marked?.mode === "annotation") {
      groups = d.markedAnnotationGroups.map((g) => ({ ...g, entries: g.entries.filter((a) => markedAnnotations.has(a.key)) })).filter((g) => g.entries.length);
    } else if (marked) {
      groups = d.annotationGroups.map((g) => ({ ...g, entries: g.entries.filter((a) => markedItems.has(index.itemKeyOf(a) ?? "")) })).filter((g) => g.entries.length);
    } else {
      groups = d.annotationGroups;
    }
    const blocks: string[] = [];
    let onlyAnn: { ctx: Record<string, unknown>; key: string } | null = null;
    for (const g of groups) {
      if (g.label && settings.groupHeaders && kind !== "link") blocks.push(`### ${g.label} (${g.entries.length})`);
      for (const a of g.entries) {
        const ctx = standaloneAnnotationContext(index, a, opts, position.get(a.key) ?? 0);
        onlyAnn = { ctx, key: a.key };
        images.push(...imagesOf([ctx.annotation as Record<string, unknown>]));
        blocks.push(kind === "link" ? engine.render(tpl.source, ctx, tpl.name).trim() : engine.render(tpl.source, ctx, tpl.name));
        annotationCount++;
      }
    }
    text = kind === "link" ? blocks.join("\n") : joinParts(blocks);
    if (annotationCount === 1 && onlyAnn) {
      single = onlyAnn.ctx;
      singleKey = onlyAnn.key;
    }
  } else {
    const style = request.style || settings.defaultStyle;
    // Un adjunto sin contenedor no es una obra: no tiene entrada bibliográfica.
    const attachmentOnly = items.filter((i) => i.fromAttachment);
    if (attachmentOnly.length) {
      warnings.push(`${attachmentOnly.length} adjunto(s) sin contenedor no tienen entrada bibliográfica.`);
      items = items.filter((i) => !i.fromAttachment);
    }
    const { entries, failed } = items.length ? await deps.fetchBibliography(items.map((i) => i.key), style) : { entries: [], failed: [] };
    if (failed.length) warnings.push(`${failed.length} ítem(s) sin entrada bibliográfica.`);
    text = tpl.builtin
      ? entries.join("\n\n")
      : engine.render(tpl.source, { bibliography: entries, style, count: entries.length, items: items.map((i) => ({ ...i.fields, key: i.key, title: i.title })) }, tpl.name);
    const onlyItem = items.length === 1 ? items[0] : undefined;
    if (onlyItem) {
      single = itemContext(index, onlyItem, [], [], opts);
      singleKey = onlyItem.key;
    }
  }

  // Solo se copian las imágenes que el texto realmente referencia
  const used = new Map<string, PreviewImage>();
  for (const img of images) if (text.includes(img.relativePath)) used.set(img.relativePath, img);

  return { text, images: [...used.values()], items: items.length, annotations: annotationCount, warnings, template: tpl.name, entity, single, singleKey };
}

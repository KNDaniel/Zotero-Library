import { DEFAULT_NOTE_NAME_TEMPLATE } from "./output/noteName";
import { homedir } from "os";
import type { AnnotationSortKey, ItemSortKey, SortDir } from "./filter/sortGroup";
import type { Condition } from "./filter/query";
import { DEFAULT_IMAGE_NAME_TEMPLATE } from "./template/context";
import type { ViewState } from "./ui/state";
import { defaultViewState } from "./ui/state";
import { normalizeVaultFolder } from "./vaultPaths";

export interface ZoteroLibrarySettings {
  /** URL base del servidor local de Zotero (127.0.0.1 evita problemas de IPv6 con «localhost») */
  baseUrl: string;
  /** Requiere consentimiento explícito para enviar la biblioteca a un servidor remoto HTTPS. */
  allowRemoteHost: boolean;
  /** users/0 = biblioteca personal; groups/<id> = biblioteca de grupo */
  libraryPath: string;
  /** Carpeta de datos de Zotero (contiene storage/ y cache/) */
  zoteroDataDir: string;

  /** Guarda una copia comprimida de la biblioteca en la carpeta del plugin para abrir al instante */
  useDiskCache: boolean;
  /** Última vez que se habló con Zotero con éxito (carga o sincronización, aunque no hubiera cambios); 0 = nunca */
  lastSyncAt: number;

  /** Carpeta del vault donde se buscan las plantillas */
  templatesFolder: string;
  /** Formato de fila de la lista de ítems por defecto: «builtin:<id>» o ruta de una plantilla; vacío = Autor (Año) — Título */
  defaultRowFormat: string;
  /** Plantillas de renderizado por defecto (ruta relativa a la carpeta de plantillas) */
  defaultItemRender: string;
  defaultAnnotationRender: string;
  /** Plantillas de impresión por defecto, una por salida */
  defaultPrintFull: string;
  defaultPrintMeta: string;
  defaultPrintAnnotations: string;
  defaultPrintBibliography: string;
  defaultPrintLink: string;
  /** Estilo CSL para la bibliografía (apa, iso690-author-date-es…) */
  bibliographyStyle: string;

  /** Última comparación de plantilla (se recuerda entre usos) */
  compareTemplate: string;
  compareItemKey: string;
  compareNotePath: string;

  /** Salidas: carpeta de las notas nuevas y comportamiento */
  newNoteFolder: string;
  /** Plantilla del nombre de las notas nuevas de ítems y de anotaciones */
  noteNameItem: string;
  noteNameAnnotation: string;
  openNewNote: boolean;
  /** Con varios ítems, quita el YAML inicial de cada nota para poder juntarlas */
  stripFrontmatterMulti: boolean;
  /** Encabezado con el nombre del grupo cuando los resultados están agrupados */
  groupHeaders: boolean;
  /** Copia al vault las imágenes de anotaciones que la salida referencia */
  copyImagesOnOutput: boolean;

  /** Estado de la vista que se recuerda entre sesiones (colecciones, búsqueda, modo, orden…) */
  viewState: Partial<ViewState>;

  /** Imágenes de anotaciones: carpeta del vault y plantilla Nunjucks del nombre (sin extensión) */
  imagesFolder: string;
  imageNameTemplate: string;
}

export function defaultSettings(): ZoteroLibrarySettings {
  return {
    baseUrl: "http://127.0.0.1:23119",
    allowRemoteHost: false,
    libraryPath: "users/0",
    zoteroDataDir: `${homedir()}/Zotero`.replace(/\\/g, "/"),
    useDiskCache: true,
    lastSyncAt: 0,
    templatesFolder: "Zotero Library/Plantillas",
    defaultRowFormat: "",
    defaultItemRender: "",
    defaultAnnotationRender: "",
    defaultPrintFull: "",
    defaultPrintMeta: "",
    defaultPrintAnnotations: "",
    defaultPrintBibliography: "",
    defaultPrintLink: "",
    bibliographyStyle: "apa",
    compareTemplate: "",
    compareItemKey: "",
    compareNotePath: "",
    newNoteFolder: "Zotero Library/Salidas",
    noteNameItem: DEFAULT_NOTE_NAME_TEMPLATE,
    noteNameAnnotation: DEFAULT_NOTE_NAME_TEMPLATE,
    openNewNote: true,
    stripFrontmatterMulti: true,
    groupHeaders: true,
    copyImagesOnOutput: true,
    viewState: {},
    imagesFolder: "Recursos/Img. Titulos",
    imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === "string" && choices.some((choice) => choice === value);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function parseCondition(value: unknown): Condition | undefined {
  if (!isRecord(value) || typeof value.field !== "string" || typeof value.value !== "string" || typeof value.negate !== "boolean") return;
  const operators = ["contains", "equals", "startsWith", "empty", "gt", "gte", "lt", "lte", "between"] as const;
  if (!isOneOf(value.op, operators)) return;
  if (value.value2 !== undefined && typeof value.value2 !== "string") return;
  return { field: value.field, op: value.op, value: value.value, negate: value.negate, ...(typeof value.value2 === "string" ? { value2: value.value2 } : {}) };
}

function parseSort<K extends string>(value: unknown, keys: readonly K[]): { key: K; dir: SortDir } | undefined {
  if (!isRecord(value) || !isOneOf(value.key, keys) || !isOneOf(value.dir, ["asc", "desc"] as const)) return;
  return { key: value.key, dir: value.dir };
}

/** Acepta únicamente los campos persistibles conocidos y los normaliza por tipo. */
function parseViewState(value: unknown): Partial<ViewState> {
  if (!isRecord(value)) return {};
  const result: Partial<ViewState> = {};
  const strings = ["searchText", "rowFormat", "outputStyle"] as const;
  for (const key of strings) if (typeof value[key] === "string") result[key] = value[key];
  for (const key of ["collections"] as const) {
    const entries = stringArray(value[key]);
    if (entries) result[key] = entries;
  }
  if (typeof value.includeSubcollections === "boolean") result.includeSubcollections = value.includeSubcollections;
  if (isOneOf(value.searchMode, ["simple", "complex"] as const)) result.searchMode = value.searchMode;
  if (isOneOf(value.combine, ["and", "or"] as const)) result.combine = value.combine;
  if (Array.isArray(value.complexConditions)) result.complexConditions = value.complexConditions.map(parseCondition).filter((condition): condition is Condition => condition !== undefined);
  const listSort = parseSort<ItemSortKey>(value.listSort, ["date", "author", "title", "itemType", "dateAdded"]);
  if (listSort) result.listSort = listSort;
  const itemSort = parseSort<ItemSortKey>(value.itemSort, ["date", "author", "title", "itemType", "dateAdded"]);
  if (itemSort) result.itemSort = itemSort;
  const annotationSort = parseSort<AnnotationSortKey>(value.annotationSort, ["page", "dateAdded", "color", "item"]);
  if (annotationSort) result.annotationSort = annotationSort;
  if (isOneOf(value.listGroup, ["none", "collection", "itemType", "author", "year"] as const)) result.listGroup = value.listGroup;
  if (isOneOf(value.itemGroup, ["none", "collection", "itemType", "author", "year"] as const)) result.itemGroup = value.itemGroup;
  if (isOneOf(value.annotationGroup, ["none", "item", "color", "tag"] as const)) result.annotationGroup = value.annotationGroup;
  if (isOneOf(value.tagMatch, ["all", "any"] as const)) result.tagMatch = value.tagMatch;
  if (isOneOf(value.mode, ["item", "annotation"] as const)) result.mode = value.mode;
  if (isOneOf(value.contentScope, ["both", "comment", "text"] as const)) result.contentScope = value.contentScope;
  if (isOneOf(value.outputKind, ["full", "meta", "annotations", "bibliography", "link"] as const)) result.outputKind = value.outputKind;
  if (isRecord(value.outputTemplates)) {
    const defaults = defaultViewState().outputTemplates;
    const templates = { ...defaults };
    let hasTemplate = false;
    for (const kind of ["full", "meta", "annotations", "bibliography", "link"] as const) {
      const template = value.outputTemplates[kind];
      if (typeof template === "string") {
        templates[kind] = template;
        hasTemplate = true;
      }
    }
    if (hasTemplate) result.outputTemplates = templates;
  }
  return result;
}

/** Mergea datos persistidos sin confiar en el tipo `any` devuelto por loadData(). */
export function mergeStoredSettings(saved: unknown): ZoteroLibrarySettings {
  const defaults = defaultSettings();
  const merged = { ...defaults };
  if (!isRecord(saved)) return merged;

  const stringKeys: Array<keyof ZoteroLibrarySettings> = [
    "baseUrl", "libraryPath", "zoteroDataDir", "templatesFolder", "defaultRowFormat",
    "defaultItemRender", "defaultAnnotationRender", "defaultPrintFull", "defaultPrintMeta",
    "defaultPrintAnnotations", "defaultPrintBibliography", "defaultPrintLink", "bibliographyStyle",
    "compareTemplate", "compareItemKey", "compareNotePath", "newNoteFolder", "noteNameItem",
    "noteNameAnnotation", "imagesFolder", "imageNameTemplate",
  ];
  const mergedRecord = merged as unknown as Record<string, unknown>;
  for (const key of stringKeys) {
    const value = saved[key];
    if (typeof value === "string") mergedRecord[key] = value;
  }

  const booleanKeys: Array<keyof ZoteroLibrarySettings> = [
    "allowRemoteHost", "useDiskCache", "openNewNote", "stripFrontmatterMulti", "groupHeaders", "copyImagesOnOutput",
  ];
  for (const key of booleanKeys) {
    const value = saved[key];
    if (typeof value === "boolean") Object.assign(merged, { [key]: value });
  }

  if (typeof saved.lastSyncAt === "number" && Number.isFinite(saved.lastSyncAt) && saved.lastSyncAt >= 0) {
    merged.lastSyncAt = saved.lastSyncAt;
  }
  merged.viewState = parseViewState(saved.viewState);

  for (const key of ["templatesFolder", "newNoteFolder", "imagesFolder"] as const) {
    const normalized = normalizeVaultFolder(merged[key]);
    if (normalized === null) merged[key] = defaults[key];
    else merged[key] = normalized;
  }
  return merged;
}

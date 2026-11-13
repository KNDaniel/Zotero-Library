import { DEFAULT_NOTE_NAME_TEMPLATE } from "./output/noteName";
import { homedir } from "os";
import { DEFAULT_IMAGE_NAME_TEMPLATE } from "./template/context";
import type { ViewState } from "./ui/state";

export interface ZoteroLibrarySettings {
  /** URL base del servidor local de Zotero (127.0.0.1 evita problemas de IPv6 con «localhost») */
  baseUrl: string;
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

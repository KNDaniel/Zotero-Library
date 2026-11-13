/**
 * Nombres en español de los tipos de ítem de Zotero. Solo para lo que se ve (agrupar, ordenar,
 * filtros, lista): la variable `itemType` de las plantillas sigue en inglés para no romper las del usuario.
 */
export const ITEM_TYPE_LABELS: Record<string, string> = {
  artwork: "Obra de arte",
  attachment: "Adjunto",
  audioRecording: "Grabación de audio",
  bill: "Proyecto de ley",
  blogPost: "Entrada de blog",
  book: "Libro",
  bookSection: "Capítulo de libro",
  case: "Caso judicial",
  computerProgram: "Programa informático",
  conferencePaper: "Ponencia",
  dataset: "Conjunto de datos",
  dictionaryEntry: "Entrada de diccionario",
  document: "Documento",
  email: "Correo electrónico",
  encyclopediaArticle: "Artículo de enciclopedia",
  film: "Película",
  forumPost: "Mensaje de foro",
  hearing: "Audiencia",
  instantMessage: "Mensaje instantáneo",
  interview: "Entrevista",
  journalArticle: "Artículo de revista académica",
  letter: "Carta",
  magazineArticle: "Artículo de revista",
  manuscript: "Manuscrito",
  map: "Mapa",
  newspaperArticle: "Artículo de periódico",
  note: "Nota",
  patent: "Patente",
  podcast: "Podcast",
  preprint: "Prepublicación",
  presentation: "Presentación",
  radioBroadcast: "Programa de radio",
  report: "Informe",
  standard: "Norma",
  statute: "Ley",
  thesis: "Tesis",
  tvBroadcast: "Programa de televisión",
  videoRecording: "Grabación de video",
  webpage: "Página web",
};

/** Nombre en español de un tipo; si no está en la tabla (tipo nuevo de Zotero) se muestra el original. */
export function itemTypeLabel(type: string): string {
  return ITEM_TYPE_LABELS[type] ?? type;
}

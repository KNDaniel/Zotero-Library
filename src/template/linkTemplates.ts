/**
 * Plantillas incluidas de la salida «Enlace Markdown». Cada una tiene una versión para ítems y otra para
 * anotaciones (con una anotación, el enlace «abrir» apunta a ella: `open` con `?page=…&annotation=…`).
 * Los títulos escapan los corchetes para no romper el enlace Markdown.
 */
export interface LinkTemplate {
  id: string;
  label: string;
  item: string;
  annotation: string;
}

/** Los valores de la lista de plantillas llevan este prefijo para no confundirse con un archivo de la carpeta de plantillas. */
export const LINK_TEMPLATE_PREFIX = "builtin:";

const TITLE = String.raw`{{ title | replace("[", "\\[") | replace("]", "\\]") }}`;

export const LINK_TEMPLATES: [LinkTemplate, ...LinkTemplate[]] = [
  { id: "title-select", label: "Título → seleccionar", item: `[${TITLE}]({{ select }})`, annotation: `[${TITLE}]({{ select }})` },
  { id: "title-open", label: "Título → abrir", item: `[${TITLE}]({{ openURI }})`, annotation: `[${TITLE}]({{ annotation.desktopURI }})` },
  { id: "only-select", label: "Solo select", item: "[select]({{ select }})", annotation: "[select]({{ select }})" },
  { id: "only-open", label: "Solo open", item: "[open]({{ openURI }})", annotation: "[open]({{ annotation.desktopURI }})" },
  { id: "id", label: "ID", item: "{{ key }}", annotation: "{{ annotation.key }}" },
];

/** La plantilla incluida de un valor de la lista (`builtin:<id>`); undefined si no lo es o no existe. */
export function linkTemplateById(value: string): LinkTemplate | undefined {
  if (!value.startsWith(LINK_TEMPLATE_PREFIX)) return undefined;
  const id = value.slice(LINK_TEMPLATE_PREFIX.length);
  return LINK_TEMPLATES.find((t) => t.id === id);
}

/** La plantilla incluida por defecto de esta salida. */
export const DEFAULT_LINK_TEMPLATE = LINK_TEMPLATES[0];

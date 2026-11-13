import { Notice, PluginSettingTab, Setting, type App, type SettingDefinitionItem } from "obsidian";
import type ZoteroLibraryPlugin from "../main";
import type { ZoteroLibrarySettings } from "../settings";
import { BUILTIN_PREFIX, ROW_FORMATS } from "../template/rowFormats";
import { validateZoteroBaseUrl } from "../source/endpoint";
import { validateLibraryPath } from "../source/endpoint";
import { normalizeVaultFolder } from "../vaultPaths";
import { isAbsolute } from "node:path";
export class ZoteroLibrarySettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ZoteroLibraryPlugin,
  ) {
    super(app, plugin);
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof ZoteroLibrarySettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const normalized = typeof value === "string" ? value.trim() : value;
    settings[key] = key === "zoteroDataDir" && typeof normalized === "string"
      ? normalized.replace(/\\/g, "/")
      : ["templatesFolder", "newNoteFolder", "imagesFolder"].includes(key) && typeof normalized === "string"
        ? normalized.replace(/^\/+|\/+$/g, "")
        : normalized;
    await this.plugin.saveSettings();
    this.refreshDomState();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const settings = this.plugin.settings;
    const saveButton = (name: string, desc: string, label: string, action: () => void | Promise<void>) => ({
      name,
      desc,
      render: (setting: Setting) => { setting.addButton((button) => button.setButtonText(label).onClick(() => void action())); },
    });
    const templateOptions = (includeDefault = true): Record<string, string> => {
      const options: Record<string, string> = {};
      if (includeDefault) options[""] = "Por defecto";
      for (const path of this.plugin.templatePaths()) options[path] = path;
      return options;
    };
    const templateControl = (name: string, desc: string, key: keyof ZoteroLibrarySettings) => ({
      name,
      desc,
      control: { type: "dropdown" as const, key: String(key), options: templateOptions() },
    });
    const textControl = (name: string, desc: string, key: keyof ZoteroLibrarySettings, placeholder?: string) => ({
      name,
      desc,
      control: { type: "text" as const, key: String(key), ...(placeholder ? { placeholder } : {}) },
    });
    const toggleControl = (name: string, desc: string, key: keyof ZoteroLibrarySettings) => ({
      name,
      desc,
      control: { type: "toggle" as const, key: String(key) },
    });

    return [
      {
        type: "group",
        heading: "Conexión con Zotero",
        items: [
          {
            ...textControl("URL del servidor", "Zotero debe estar abierto y permitir conexiones de otras aplicaciones. Por defecto, las solicitudes solo van a este equipo.", "baseUrl", "http://127.0.0.1:23119"),
            aliases: ["localhost", "API local", "URL"],
            control: {
              type: "text" as const,
              key: "baseUrl",
              placeholder: "http://127.0.0.1:23119",
              validate: (value: string) => {
                try { validateZoteroBaseUrl(value, settings.allowRemoteHost); } catch (error) { return (error as Error).message; }
              },
            },
          },
          toggleControl("Permitir servidor remoto", "Confirma que confías en el host configurado. Ese servidor recibirá las solicitudes y los datos de Zotero consultados; para hosts remotos se exige HTTPS.", "allowRemoteHost"),
          {
            ...textControl("Biblioteca", "users/0 para la biblioteca personal; groups/<id> para una biblioteca de grupo.", "libraryPath", "users/0"),
            control: { type: "text" as const, key: "libraryPath", placeholder: "users/0", validate: (value: string) => { try { validateLibraryPath(value); } catch (error) { return (error as Error).message; } } },
          },
          {
            ...textControl("Carpeta de datos de Zotero", "El plugin consulta la existencia de algunos adjuntos en storage/ y cache/library/. Lee PNG de cache/library/ solo cuando una salida los referencia y activas su copia al vault.", "zoteroDataDir"),
            control: { type: "text" as const, key: "zoteroDataDir", validate: (value: string) => !isAbsolute(value.trim()) ? "Indica una ruta absoluta a la carpeta de datos de Zotero." : undefined },
          },
          saveButton("Probar conexión", "Consulta Zotero usando el host validado de arriba.", "Probar conexión", () => this.plugin.testConnection()),
          toggleControl("Copia local comprimida", "Guarda una copia de la biblioteca en la carpeta de datos del plugin dentro del vault; puede contener metadatos bibliográficos.", "useDiskCache"),
          saveButton("Borrar la copia local", "Elimina solo la caché local de Zotero de este plugin.", "Borrar la copia", async () => { new Notice((await this.plugin.clearCache()) ? "Copia borrada." : "No había ninguna copia."); }),
          saveButton("Recargar la biblioteca", "Vuelve a pedir la biblioteca a Zotero.", "Recargar todo", async () => { await this.plugin.loadLibrary(true); }),
        ],
      },
      {
        type: "group",
        heading: "Plantillas",
        items: [
          {
            name: "Confianza de plantillas",
            desc: "Nunjucks no aísla las plantillas: su código se ejecuta en el contexto del plugin. Usa solo plantillas propias o revisadas. El plugin les pasa una copia de datos bibliográficos, no objetos vivos de Obsidian ni del plugin.",
          },
          { name: "Carpeta de plantillas", desc: "Carpeta del vault donde se buscan archivos .md, .njk y .txt.", control: { type: "folder" as const, key: "templatesFolder", placeholder: "Zotero Library/Plantillas", validate: (value: string) => normalizeVaultFolder(value) === null ? "La carpeta debe quedar dentro del vault." : undefined } },
          saveButton("Editar plantilla incluida", "Crea una nota con una plantilla predeterminada para editarla.", "Elegir plantilla…", () => this.plugin.pickDefaultTemplate()),
          { name: "Formato de fila", desc: "Formato de cada ítem en la lista.", control: { type: "dropdown" as const, key: "defaultRowFormat", options: { "": "Por defecto (Autor (Año) — Título)", ...Object.fromEntries(ROW_FORMATS.map((f) => [BUILTIN_PREFIX + f.id, f.label])), ...templateOptions(false) } } },
          templateControl("Renderizar ítems", "Plantilla para las tarjetas de ítems.", "defaultItemRender"),
          templateControl("Renderizar anotaciones", "Plantilla para las tarjetas de anotaciones.", "defaultAnnotationRender"),
          templateControl("Impresión: metadata + anotaciones", "Plantilla de salida completa por ítem.", "defaultPrintFull"),
          templateControl("Impresión: solo metadata", "Plantilla de salida de metadata.", "defaultPrintMeta"),
          templateControl("Impresión: solo anotaciones", "Plantilla de salida de anotaciones.", "defaultPrintAnnotations"),
          templateControl("Impresión: bibliografía", "Plantilla para la bibliografía.", "defaultPrintBibliography"),
          templateControl("Impresión: enlaces Markdown", "Plantilla para crear enlaces Markdown.", "defaultPrintLink"),
          textControl("Estilo bibliográfico", "Identificador CSL instalado en Zotero.", "bibliographyStyle", "apa"),
        ],
      },
      {
        type: "group",
        heading: "Notas y salidas",
        items: [
          { name: "Carpeta de notas nuevas", desc: "Destino de la acción «Nueva nota» dentro del vault.", control: { type: "folder" as const, key: "newNoteFolder", placeholder: "Zotero Library/Salidas", validate: (value: string) => normalizeVaultFolder(value) === null ? "La carpeta debe quedar dentro del vault." : undefined } },
          { name: "Nombre de notas de ítems", desc: "Plantilla Nunjucks de confianza para los nombres de archivo.", control: { type: "text" as const, key: "noteNameItem" } },
          { name: "Nombre de notas de anotaciones", desc: "Plantilla Nunjucks de confianza para los nombres de archivo.", control: { type: "text" as const, key: "noteNameAnnotation" } },
          toggleControl("Abrir nota nueva", "Abre la nota después de crearla.", "openNewNote"),
          toggleControl("Quitar frontmatter en salidas múltiples", "Quita el YAML inicial de cada pieza al combinar varios ítems.", "stripFrontmatterMulti"),
          toggleControl("Encabezados de grupo", "Añade encabezados cuando la salida de anotaciones está agrupada.", "groupHeaders"),
        ],
      },
      {
        type: "group",
        heading: "Imágenes de anotaciones",
        items: [
          { name: "Copiar imágenes al vault al generar salidas", desc: "Solo lee PNG de cache/library de Zotero y los copia a la carpeta configurada dentro del vault cuando una salida los referencia.", control: { type: "toggle" as const, key: "copyImagesOnOutput" } },
          { name: "Carpeta de imágenes", desc: "Carpeta del vault donde se guardan copias de PNG.", control: { type: "folder" as const, key: "imagesFolder", placeholder: "Recursos/Img. Titulos", validate: (value: string) => normalizeVaultFolder(value) === null ? "La carpeta debe quedar dentro del vault." : undefined } },
          textControl("Nombre de cada imagen", "Plantilla Nunjucks de confianza para el nombre del PNG.", "imageNameTemplate"),
        ],
      },
    ];
  }

}

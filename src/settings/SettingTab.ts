import { Notice, PluginSettingTab, Setting, type App, type SettingDefinitionItem } from "obsidian";
import type ZoteroLibraryPlugin from "../main";
import type { ZoteroLibrarySettings } from "../settings";
import { FolderSuggest } from "../FolderSuggest";
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
            ...textControl("Carpeta de datos de Zotero", "El plugin lee storage/ para ubicar adjuntos y cache/library/ para imágenes. Copia PNG al vault solo si activas esa opción y generas una salida.", "zoteroDataDir"),
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
            desc: "Las plantillas Nunjucks pueden generar contenido activo. Usa solo plantillas de fuentes en las que confíes; reciben una copia de datos bibliográficos y no tienen acceso a las API de Obsidian ni al sistema de archivos.",
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

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Conexión con Zotero").setHeading();

    new Setting(containerEl)
      .setName("URL del servidor local")
      .setDesc("Zotero debe estar abierto y con la opción «Permitir que otras aplicaciones de este equipo se comuniquen con Zotero» activada.")
      .addText((t) =>
        t.setValue(this.plugin.settings.baseUrl).onChange(async (v) => {
          this.plugin.settings.baseUrl = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Biblioteca")
      .setDesc("users/0 para tu biblioteca personal; groups/<id> para una biblioteca de grupo.")
      .addText((t) =>
        t.setValue(this.plugin.settings.libraryPath).onChange(async (v) => {
          this.plugin.settings.libraryPath = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Carpeta de datos de Zotero")
      .setDesc("La que contiene storage/ y cache/. Se usa para localizar los PDF y las imágenes de anotaciones.")
      .addText((t) =>
        t.setValue(this.plugin.settings.zoteroDataDir).onChange(async (v) => {
          this.plugin.settings.zoteroDataDir = v.trim().replace(/\\/g, "/");
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).addButton((b) =>
      b.setButtonText("Probar conexión").onClick(() => void this.plugin.testConnection()),
    );

    new Setting(containerEl)
      .setName("Copia de la biblioteca en disco")
      .setDesc("Guarda una copia comprimida en la carpeta del plugin para abrir al instante y sincronizar solo los cambios. Funciona también con Zotero cerrado (con los datos de la última sincronización).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.useDiskCache).onChange(async (v) => {
          this.plugin.settings.useDiskCache = v;
          await this.plugin.saveSettings();
        }),
      )
      .addButton((b) =>
        b.setButtonText("Borrar la copia").onClick(async () => {
          new Notice((await this.plugin.clearCache()) ? "Copia borrada." : "No había ninguna copia.");
        }),
      )
      .addButton((b) =>
        b.setButtonText("Recargar todo").onClick(() => void this.plugin.loadLibrary(true)),
      );

    // --- Plantillas ---
    new Setting(containerEl).setName("Plantillas").setHeading();

    new Setting(containerEl)
      .setName("Carpeta de plantillas")
      .setDesc("Carpeta del vault donde se buscan las plantillas (.md, .njk, .txt). Puede ser la misma que ya usas con Zotero Integration.")
      .addText((t) => {
        t.setPlaceholder("Zotero Library/Plantillas").setValue(this.plugin.settings.templatesFolder).onChange(async (v) => {
          this.plugin.settings.templatesFolder = v.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
        });
        new FolderSuggest(this.app, t.inputEl, async (path) => {
          this.plugin.settings.templatesFolder = path;
          await this.plugin.saveSettings();
          this.display(); // refresca las listas de plantillas
        });
      });

    new Setting(containerEl)
      .setName("Editar una plantilla por defecto")
      .setDesc("Crea en la raíz de la bóveda una nota con el contenido de una plantilla por defecto (ítem, anotación, impresión o formato de fila) para modificarla. No cambia la opción «Por defecto»; después, mueve la nota a la carpeta de plantillas y elígela.")
      .addButton((b) => b.setButtonText("Elegir plantilla…").onClick(() => this.plugin.pickDefaultTemplate()));

    const available = this.plugin.templatePaths();
    const templateDropdown = (name: string, desc: string, key: keyof ZoteroLibrarySettings) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addDropdown((d) => {
          const current = String(this.plugin.settings[key] ?? "");
          d.addOption("", "Por defecto");
          for (const t of available) d.addOption(t, t);
          if (current && !available.includes(current)) d.addOption(current, `${current} (no encontrada)`);
          d.setValue(current).onChange(async (v) => {
            (this.plugin.settings[key] as string) = v;
            await this.plugin.saveSettings();
          });
        });

    new Setting(containerEl).setName("Lista de ítems").setHeading();
    new Setting(containerEl)
      .setName("Formato de fila")
      .setDesc("Cómo se muestra cada ítem en la lista. Es una plantilla Nunjucks de una línea, independiente de las demás plantillas; también se puede cambiar desde la propia lista.")
      .addDropdown((d) => {
        const current = this.plugin.settings.defaultRowFormat ?? "";
        d.addOption("", "Por defecto (Autor (Año) — Título)");
        for (const f of ROW_FORMATS) d.addOption(BUILTIN_PREFIX + f.id, f.label);
        for (const t of available) d.addOption(t, `Plantilla: ${t}`);
        if (current && !current.startsWith(BUILTIN_PREFIX) && !available.includes(current)) d.addOption(current, `${current} (no encontrada)`);
        d.setValue(current).onChange(async (v) => {
          this.plugin.settings.defaultRowFormat = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Renderizado (las tarjetas del panel de resultados)").setHeading();
    templateDropdown("Ítems", "Muestra la metadata de cada ítem seleccionado.", "defaultItemRender");
    templateDropdown("Anotaciones", "Muestra cada anotación.", "defaultAnnotationRender");

    new Setting(containerEl).setName("Impresión (copiar, insertar en nota, imprimir)").setHeading();
    templateDropdown("Metadata + anotaciones", "Una vez por ítem, con sus anotaciones. Aquí va tu plantilla de importación.", "defaultPrintFull");
    templateDropdown("Solo metadata", "Una vez por ítem.", "defaultPrintMeta");
    templateDropdown("Solo anotaciones", "Las anotaciones del resultado.", "defaultPrintAnnotations");
    templateDropdown("Bibliografía", "Formateada por Zotero con el estilo de abajo.", "defaultPrintBibliography");
    templateDropdown("Enlace Markdown", "Una línea por ítem o anotación. Vacío = «Título → seleccionar»; las otras plantillas incluidas se eligen en la barra de salida.", "defaultPrintLink");
    new Setting(containerEl)
      .setName("Estilo bibliográfico")
      .setDesc("Identificador CSL instalado en Zotero: apa, chicago-author-date, iso690-author-date-es…")
      .addText((t) =>
        t.setValue(this.plugin.settings.bibliographyStyle).onChange(async (v) => {
          this.plugin.settings.bibliographyStyle = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Carpeta de las notas nuevas")
      .setDesc("Donde «Nueva nota» crea la nota con el resultado.")
      .addText((t) => {
        t.setPlaceholder("Zotero Library/Salidas").setValue(this.plugin.settings.newNoteFolder).onChange(async (v) => {
          this.plugin.settings.newNoteFolder = v.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
        });
        new FolderSuggest(this.app, t.inputEl, async (path) => {
          this.plugin.settings.newNoteFolder = path;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Nombre de las notas de ítems")
      .setDesc("Plantilla Nunjucks, sin extensión. Con un solo ítem puedes usar sus variables ({{ title }}, {{ authors }}, {{ year }}, {{ key }}…); siempre están {{ stamp }} (fecha y hora) y {{ count }}. Si el nombre ya existe se añade la clave de Zotero.")
      .addText((t) => {
        t.inputEl.style.width = "100%";
        t.setValue(this.plugin.settings.noteNameItem).onChange(async (v) => {
          this.plugin.settings.noteNameItem = v;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Nombre de las notas de anotaciones")
      .setDesc("Igual, con las variables de la anotación y de su ítem ({{ annotation.pageLabel }}, {{ title }}, {{ annotation.key }}…).")
      .addText((t) => {
        t.inputEl.style.width = "100%";
        t.setValue(this.plugin.settings.noteNameAnnotation).onChange(async (v) => {
          this.plugin.settings.noteNameAnnotation = v;
          await this.plugin.saveSettings();
        });
      });
    const toggle = (name: string, desc: string, key: "openNewNote" | "stripFrontmatterMulti" | "groupHeaders" | "copyImagesOnOutput") =>
      new Setting(containerEl).setName(name).setDesc(desc).addToggle((t) =>
        t.setValue(this.plugin.settings[key]).onChange(async (v) => {
          this.plugin.settings[key] = v;
          await this.plugin.saveSettings();
        }),
      );
    toggle("Abrir la nota nueva", "Tras crearla, se abre en una pestaña.", "openNewNote");
    toggle("Quitar el frontmatter con varios ítems", "Si la salida reúne varios ítems, quita el bloque YAML inicial de cada nota para poder juntarlas. Con un solo ítem se respeta tal cual.", "stripFrontmatterMulti");
    toggle("Encabezados de grupo", "Si los resultados están agrupados, la salida de anotaciones lleva un encabezado por grupo.", "groupHeaders");
    toggle("Copiar las imágenes al vault", "Al sacar anotaciones de tipo imagen, copia los archivos de la caché de Zotero a la carpeta de imágenes (si no están ya).", "copyImagesOnOutput");

    // --- Imágenes de anotaciones ---
    new Setting(containerEl).setName("Imágenes de anotaciones").setHeading();
    new Setting(containerEl)
      .setName("Carpeta de imágenes")
      .setDesc("Carpeta del vault donde se guardan las imágenes de las anotaciones de tipo imagen.")
      .addText((t) => {
        t.setPlaceholder("Recursos/Img. Titulos").setValue(this.plugin.settings.imagesFolder).onChange(async (v) => {
          this.plugin.settings.imagesFolder = v.trim().replace(/^\/+|\/+$/g, "");
          await this.plugin.saveSettings();
        });
        new FolderSuggest(this.app, t.inputEl, async (path) => {
          this.plugin.settings.imagesFolder = path;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Nombre de cada imagen")
      .setDesc("Plantilla Nunjucks, sin extensión. Variables: attachmentKey, itemKey, annotationKey, page, pageLabel, x, y, color.")
      .addText((t) => {
        t.inputEl.style.width = "100%";
        t.setValue(this.plugin.settings.imageNameTemplate).onChange(async (v) => {
          this.plugin.settings.imageNameTemplate = v;
          await this.plugin.saveSettings();
        });
      });
  }
}

# Guía de usuario

Esta guía corresponde a Zotero Library 0.9.7. El plugin es de escritorio y lee la biblioteca mediante la API local de Zotero.

## Requisitos y conexión

1. Instala/activa el plugin copiando `main.js`, `manifest.json` y `styles.css` a `.obsidian/plugins/zotero-library/` y activándolo en Complementos de la comunidad.
2. Abre Zotero y activa **Ajustes → Avanzado → Permitir que otras aplicaciones de este equipo se comuniquen con Zotero**.
3. En **Ajustes → Zotero Library**, revisa:
   - **URL del servidor**: por defecto `http://127.0.0.1:23119`. Loopback es el único destino permitido de forma predeterminada. Para otro host, activa **Permitir servidor remoto**; los hosts remotos deben usar HTTPS y recibirán las solicitudes de lectura y las claves consultadas.
   - **Biblioteca**: `users/0` para la personal o `groups/<id>` para un grupo.
   - **Carpeta de datos de Zotero**: la que contiene `storage/` y `cache/`; se usa para localizar adjuntos e imágenes.
4. Pulsa **Probar conexión** o ejecuta **Probar conexión con Zotero** desde la paleta.

La primera carga puede tardar; el estado aparece en la vista. Si la copia en disco está activada, el plugin puede mostrar datos de la última sincronización con Zotero cerrado.

## La vista

Abre **Zotero Library** con el icono de la cinta o la paleta de comandos.

En vistas estrechas (hasta 900 px), aparecen las pestañas **Ítems**, **Etiquetas** y **Resultados**. Resultados se abre inicialmente; cambia de pestaña para consultar los otros paneles. En vistas anchas los tres paneles siguen visibles a la vez.

### Ítems

El panel permite filtrar por colección, incluir subcolecciones y buscar con texto o condiciones por campos. Las filas muestran el formato elegido; se puede seleccionar más de un ítem. Los ítems ocultos por una búsqueda pueden permanecer seleccionados. **Todos** añade los ítems disponibles y **Ninguno** vacía la selección. El menú contextual permite abrir o localizar el ítem/adjunto en Zotero o en el sistema de archivos.

La búsqueda simple acepta texto y condiciones como `@autor: Marx` o `@año: XIX`. El botón de ayuda junto al campo muestra la sintaxis disponible en la versión instalada.

### Etiquetas

Muestra etiquetas de anotaciones de los ítems seleccionados. El buscador filtra la lista y el selector **Y/O** define si las anotaciones deben contener todas las etiquetas marcadas o cualquiera. Al cambiar la selección de ítems, las etiquetas que ya no estén disponibles se desmarcan.

### Resultados

El modo **Ítems** renderiza la metadata de los ítems seleccionados. El modo **Anotaciones** renderiza las anotaciones que sobreviven a los filtros de etiqueta. Se puede cambiar orden, dirección y agrupación. La lista de anotaciones carga por lotes; **Mostrar más** incorpora más tarjetas.

## Plantillas

En **Ajustes → Zotero Library → Plantillas**, define una carpeta del vault; admite `.md`, `.njk` y `.txt`. Puedes compartirla con Zotero Integration. Las plantillas pueden incluir o importar archivos de esa carpeta mediante `{% include "fragmento" %}` o `{% import "macros" as m %}`.

El contexto de ítem ofrece campos de Zotero en el nivel superior y variables como `title`, `authors`, `year`, `creators`, `annotations`, `allAnnotations`, `attachments`, `relations`, `item` y `raw`. El contexto de anotación añade `annotation` e `index`; la anotación también está expuesta dentro de `annotations` en plantillas de ítem. El comando **Explorar los datos de un ítem (variables para plantillas)** permite consultar el contexto disponible.

Hay plantillas independientes para el formato de fila, tarjetas de ítems/anotaciones, salidas de metadata, anotaciones y enlaces. El desplegable **Por defecto** usa la plantilla incluida. El botón **Editar una plantilla por defecto** crea una nota editable en la raíz del vault; después muévela a la carpeta configurada y selecciónala.

**Confianza:** Nunjucks no ejecuta las plantillas en un sandbox y el plugin desactiva el autoescape para conservar HTML. Trata las plantillas como código de confianza y no uses plantillas de procedencia desconocida. Obsidian neutraliza ciertos elementos y atributos activos al renderizar, pero el plugin no garantiza la neutralización de todo contenido HTML posible.

## Salidas

La barra **Salida** del panel de resultados ofrece:

- **Metadata + anotaciones**, **Solo metadata**, **Solo anotaciones**, **Bibliografía** y **Enlace Markdown**.
- **Copiar al portapapeles**, **Insertar en la nota activa** o **Nueva nota** en la carpeta configurada.
- Plantillas y estilo CSL configurables. La bibliografía la genera Zotero.

La salida sigue el orden, la agrupación y el filtro de etiquetas visibles. Al reunir varios ítems, se puede quitar el frontmatter de cada fragmento; con un solo ítem la plantilla se conserva íntegra. Si una nota nueva ya existe, el plugin agrega la clave de Zotero y, si es necesario, un sufijo numérico para no sobrescribirla.

Al generar una salida con anotaciones de imagen, el plugin puede copiar el PNG desde la caché local de Zotero a **Carpeta de imágenes**. Desactiva **Copiar las imágenes al vault** para no realizar esa copia. Los PNG que Zotero todavía no haya generado se informan como faltantes.

## Caché, datos y privacidad

**Copia de la biblioteca en disco** guarda una copia comprimida en `.obsidian/plugins/zotero-library/library-cache.json.gz`. Contiene datos de la biblioteca. Puedes desactivarla, borrarla o solicitar una recarga completa desde los ajustes. La caché se conserva dentro del vault; considera esto antes de sincronizar `.obsidian` o compartir el vault.

El plugin usa la URL configurada para las peticiones HTTP de la API local. El valor predeterminado apunta a loopback (`127.0.0.1`); si configuras otro host, ese servidor recibirá solicitudes y parámetros de consulta, y el plugin recibirá sus respuestas. El plugin no sube la biblioteca local ni realiza escrituras a Zotero. Usa solo un host de confianza. Habilitar en Zotero **Permitir que otras aplicaciones de este equipo se comuniquen con Zotero** permite a aplicaciones locales leer la biblioteca por esa API. El plugin no envía datos a un servicio del proyecto. Consulta la [documentación de la API local de Zotero](https://www.zotero.org/support/dev/web_api/v3/local_api).

La carpeta de datos de Zotero se encuentra fuera del vault. El plugin consulta rutas de `storage/` y `cache/` para localizar adjuntos e imágenes; al generar una salida, puede leer de esa caché y copiar los PNG referenciados al vault si está activada la opción. Los enlaces a archivos locales se abren solo cuando eliges abrirlos.

## Diagnóstico

- **Probar conexión con Zotero**: comprobación rápida.
- **Diagnosticar la conexión con Zotero**: prueba host y transporte para identificar errores locales.
- **Informe de verificación**: revisa capacidades de la API local y datos de la biblioteca cargada.
- **Mostrar el registro de diagnóstico de Zotero Library**: abre las últimas líneas del archivo `zotero-library.log`, ubicado en la carpeta de datos del plugin.
- **Reiniciar la vista de Zotero Library (si se queda en negro)**: vuelve a crear la pestaña.
- **Comparar plantilla con una nota existente**: compara el resultado de una plantilla con una nota del vault.

Para informar un problema, adjunta la versión de Obsidian/Zotero, la acción realizada y el fragmento pertinente del registro. El registro evita escribir rutas locales, query strings y pilas de error, pero puede incluir mensajes de error y claves de anotación al faltar imágenes; revísalo antes de compartirlo.

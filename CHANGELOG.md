# Cambios

## 0.9.12 — artefactos de release consistentes

- Fija finales de línea LF para CSS para que las copias locales y las de CI tengan el mismo hash y coincidan con su atestación de procedencia.
- Conserva la atestación explícita por archivo para `main.js`, `manifest.json` y `styles.css`.

## 0.9.11 — correcciones del análisis de publicación

- Sustituye la supresión de lint para `createDocumentFragment` por inserción de resaltados usando el helper DOM `createEl` de Obsidian.
- Atesta cada archivo de distribución con una ruta explícita para que `main.js`, `manifest.json` y `styles.css` tengan procedencia verificable.

## 0.9.10 — remediación de advertencias de revisión

- Endurece los límites de lectura de archivos externos de Zotero y valida rutas canónicas antes de consultar o copiar imágenes.
- Valida campo por campo el estado de vista persistido y fortalece las comprobaciones de tipos de las APIs dinámicas de Electron y Obsidian.
- Elimina aserciones/importaciones redundantes y retira `display: contents` del diseño responsive sin cambiar el flujo de paneles.
- Aclara que el portapapeles solo se escribe al copiar y que las plantillas Nunjucks deben ser de confianza.

## 0.9.9 — remediación de advertencias y límites de acceso

- Guarda el registro mediante el adaptador del vault y limita las comprobaciones de disco a la ruta real de datos de Zotero.
- Enumera plantillas solo dentro de la carpeta configurada y valida los ajustes persistidos antes de usarlos.
- Aclara que Nunjucks no ofrece sandbox y que las plantillas deben ser de confianza.
- Corrige avisos de lint confirmados y elimina `!important` donde la especificidad conserva el comportamiento.

## 0.9.8 — compatibilidad con la revisión de Obsidian

- Sustituye los estilos inline por clases CSS o por los helpers CSS de Obsidian.
- Usa solo la API declarativa de ajustes, que mejora la búsqueda y evita el método `display()` obsoleto.
- Actualiza los helpers de elementos y botones destructivos y elimina código sin uso.

## 0.9.7 — seguridad y privacidad

- Restringe por defecto la API de Zotero a loopback; los servidores remotos requieren autorización explícita y HTTPS.
- Valida la URL, la ruta de biblioteca y las carpetas configuradas antes de usarlas.
- Aísla los datos expuestos a las plantillas Nunjucks y advierte que solo deben usarse plantillas de confianza.
- Redacta rutas y URLs sensibles de los registros y evita consultar rutas de adjuntos malformadas.
- Confirma antes de sobrescribir informes y limita el acceso al portapapeles a acciones explícitas.
- Añade ajustes buscables y CI con pruebas multiplataforma, build reproducible y atestación de artefactos.

## 0.9.6 — versión inicial (12-nov-2026)

- Explora ítems, colecciones, etiquetas y anotaciones de Zotero en tres paneles coordinados.
- Añade búsqueda, filtros simples y complejos, orden, agrupación y plantillas Nunjucks compatibles con Zotero Integration.
- Permite copiar, insertar o crear notas, y copiar opcionalmente imágenes de anotaciones al vault.
- Guarda una caché local comprimida para abrir la biblioteca y sincronizar cambios incrementales.
- Valida las claves de anotación antes de formar rutas de imagen y limita las lecturas PNG a la caché de Zotero.
- Declara Obsidian 1.15.0 como versión mínima conservadora comprobada en Windows.

Las versiones probadas, plataformas no verificadas y límites de privacidad están en el README y la guía de usuario.

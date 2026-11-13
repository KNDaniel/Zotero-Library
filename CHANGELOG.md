# Cambios

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

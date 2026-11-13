# Desarrollo

## Requisitos y comandos

Requiere Node.js y pnpm compatibles con las versiones de `package.json` y `pnpm-lock.yaml`.

Entorno de la línea base del 12-nov-2026: Node.js `v26.13.1`, fijado en `.nvmrc`, y pnpm `12.18.0`, fijado en `package.json` mediante `packageManager`. La instalación congelada, `pnpm run check`, build y cinco smoke pasaron con esas versiones. No se declara por ello que sean las únicas versiones compatibles.

Integración comprobada el 12-nov-2026 en Windows: Obsidian `1.15.0` (instalador `1.14.5`) y Zotero `9.0.3`. `manifest.json` fija `minAppVersion: 1.15.0` como suelo conservador probado; versiones de Obsidian anteriores y macOS/Linux siguen sin verificar.

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm exec vitest run
pnpm run check
pnpm run build
pnpm run release:prepare
```

`check` ejecuta TypeScript y Vitest. `build` compila `main.js`; no edites ese bundle manualmente. Los smoke ejercitan el bundle compilado, por lo que se debe ejecutar `pnpm run build` antes:

```powershell
node scripts/smoke-bundle.mjs
node scripts/smoke-view.mjs
node scripts/smoke-sync.mjs
node scripts/smoke-output.mjs
node scripts/smoke-scale.mjs
```

Cada smoke debe terminar con `RESULTADO` satisfactorio. Los adaptadores simulados pueden escribir mensajes de caché fallida; evalúa el resultado final del proceso.

## Preparación del candidato de publicación

Después de `pnpm run build`, `pnpm run release:prepare` copia el paquete a `dist/zotero-library-<versión>/` y verifica que contenga exclusivamente `main.js`, `manifest.json` y `styles.css`, con versiones coherentes y metadatos compatibles con el directorio comunitario. Repite la verificación tras confirmar `LICENSE`:

```powershell
pnpm run release:verify -- dist/zotero-library-0.9.6
```

El verificador de publicación requiere además README, changelog, avisos de dependencias y LICENSE en la raíz. No evalúa si la licencia es jurídicamente adecuada ni sustituye la revisión oficial del directorio. Pasos y checklist: [preparación de release](lista-release.md).

## Estructura

- `src/main.ts`, `src/settings.ts`: ciclo de vida, comandos, ajustes e integración con Obsidian.
- `src/source/`: API local de Zotero, transporte y sincronización.
- `src/model/`, `src/index/`: tipos normalizados, índice y caché.
- `src/filter/`: consulta, colecciones, etiquetas, selección, orden y agrupación.
- `src/template/`: contexto y motor Nunjucks, formatos y enlaces.
- `src/ui/`: vista, paneles, lista virtual y explorador.
- `src/output/`: generación de Markdown, nombres de nota e imágenes.
- `tests/`: pruebas unitarias y de contrato; `scripts/`: smoke, fixtures, servidor API simulado y paquete de release.

Flujo: API → modelo → índice/caché → filtros (`derive`) → paneles → plantilla → salida.

## Convenciones de implementación

- Mantén lógica de dominio independiente de clases Obsidian para probarla con Vitest.
- No declares en vistas métodos con nombres del ciclo de vida/API de Obsidian como `open`, `close`, `load`, `unload` o `register*`; `tests/viewContract.test.ts` protege ese contrato.
- Pasa la vista como `Component` a `MarkdownRenderer.render` para que Obsidian administre el ciclo de vida.
- Conserva la nota dorada de `tests/fixtures/golden-note.md` byte por byte; `tests/golden.test.ts` lo verifica.
- Los componentes flotantes de `ui/floating.ts` cuelgan de `document.body`; llama a `Floating.sweep()` al reconstruir paneles.
- No refactorices componentes Markdown por tarjeta, caché de plantillas ni alturas dinámicas de `VirtualList` sin medir un caso reproducible.
- La comprobación de PNG usa concurrencia limitada a 8; conserva orden y propagación de errores.

## Vaults de prueba

- `vault-pruebas` valida la instalación y el comportamiento con la copia de biblioteca configurada en ese vault. No lo uses para insertar fixtures sintéticos.
- `vault-pruebas-seguridad-d2` es exclusivo para fixtures sintéticos de seguridad; usa `node scripts/mock-security-api.mjs` en `127.0.0.1:23121`.
- `vault-pruebas-escala` es exclusivo para datos sintéticos de rendimiento; usa `node scripts/mock-scale-api.mjs` en `127.0.0.1:23122`.
- Antes de cargar una bóveda sintética, inspecciona su `data.json`: debe apuntar al puerto de su mock local, a `users/0`, usar una ruta de datos ficticia y tener `useDiskCache` desactivado. `vault-pruebas` no es un vault sintético y conserva su configuración propia.
- Nunca copies una caché real a un vault sintético. Verifica el vault destino antes de recargar o sincronizar el plugin.
- La prueba simulada de escala no reemplaza medición visual de scroll/tema en Obsidian.

## Plantillas y seguridad

Nunjucks se ejecuta con `autoescape: false` para mantener compatibilidad HTML; no tiene sandbox. Trata las plantillas como código de confianza. Valida las rutas de imágenes mediante `src/vaultPaths.ts` y vuelve a validarlas justo antes de escribir en `src/output/images.ts`. Usa loopback para la API local salvo que exista una necesidad explícita de configurar otro host.

## Entrega

La instalación del plugin requiere solo `main.js`, `manifest.json` y `styles.css` en `.obsidian/plugins/zotero-library/`. Mantén iguales las versiones de `package.json` y `manifest.json`; compila antes de empaquetar. No incluyas datos privados ni archivos de caché en el paquete.

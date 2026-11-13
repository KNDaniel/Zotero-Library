# Lista de preparación de una versión

Esta lista produce un candidato local instalable. Publicarlo en el directorio comunitario requiere además una licencia elegida por el titular, un repositorio de GitHub accesible y una cuenta de Obsidian.

## Reproducir desde un checkout limpio

Usa Windows, Node.js `v26.13.1` (`.nvmrc`) y pnpm `12.18.0` (`packageManager`). Desde la raíz:

```powershell
pnpm install --frozen-lockfile
pnpm run check
pnpm run build
node scripts/smoke-bundle.mjs
node scripts/smoke-view.mjs
node scripts/smoke-sync.mjs
node scripts/smoke-output.mjs
node scripts/smoke-scale.mjs
pnpm run release:prepare
```

El último paso crea `dist/zotero-library-<versión>/` con solo `main.js`, `manifest.json` y `styles.css`. `dist/` está excluido del control de versiones y del paquete fuente. El build genera `main.js`; nunca lo edites a mano.

## Antes de marcarlo listo para publicar

- [x] Licencia MIT elegida por el titular; `LICENSE` y `package.json` la declaran, con el aviso de autoría `Daniel`.
- [x] Se revisaron las licencias de las dependencias incluidas y se conservaron en [los avisos de terceros](../THIRD-PARTY-NOTICES.md). Comprueba la clasificación MIT que muestra GitHub antes del envío.
- [ ] Revisa versión `x.y.z` en `package.json` y `manifest.json`; `release:prepare` comprueba igualdad, formato, descripción e `isDesktopOnly`.
- [x] Se revisaron `CHANGELOG.md`, los enlaces y la captura autorizada en README.
- [x] `pnpm run release:verify -- dist/zotero-library-0.9.6` pasó y exige `README.md`, `CHANGELOG.md`, `THIRD-PARTY-NOTICES.md` y `LICENSE`.
- [x] Prueba en Obsidian: el candidato abrió desde el mock, mostró estado «Sincronizado», la búsqueda `Capital` encontró dos ítems, se seleccionó uno y se renderizó su vista previa de salida. `smoke-output` verifica aparte la acción de crear nota. Se usó solo `vault-pruebas-fase4` y datos sintéticos.
- [x] El directorio candidato contiene solo los tres archivos de instalación; la bóveda de aceptación está fuera de él.
- [x] Piloto local de instalación, actualización, reinstalación y primer arranque completado con datos sintéticos.
- [ ] Adjunta por separado `main.js`, `manifest.json` y `styles.css` al release. La etiqueta del release debe ser idéntica a la versión de `manifest.json`.
- [ ] Comprueba la revisión automática del directorio para manifiesto, artefactos, código fuente y verificación del build.

La verificación automática valida SemVer estable `x.y.z`, la igualdad de versiones, las condiciones básicas del manifiesto y la lista exacta de archivos permitidos. La presencia de `LICENSE` no determina que su texto sea legalmente adecuado ni que GitHub vaya a clasificarlo correctamente; el titular debe comprobarlo.

## Estado actual

- Candidato instalable de `0.9.6`: preparado desde el build y listo para revisión local.
- README, changelog y captura: preparados; la captura usa los datos que el titular autorizó como no sensibles.
- Licencia: MIT, elegida por el titular; la puerta de publicación ya no depende de esta decisión.
- Compilación, 434 pruebas automatizadas, cinco pruebas de humo y verificación del candidato: aprobadas el 12-nov-2026. `pnpm install --frozen-lockfile` no pudo abrir el almacén global de pnpm por acceso denegado; las dependencias instaladas permitieron ejecutar las comprobaciones.
- Prueba visual en Obsidian: completada en `vault-pruebas-fase4`; se verificaron carga desde el mock, búsqueda, selección y vista previa de la salida. El estado de la biblioteca en pantalla fue «Sincronizado».
- Piloto local de Fase 5: completado; no participaron usuarios externos. El informe registra alcance, resultados y límites.
- Dirección de soporte: `https://github.com/KNDaniel/zotero-library/issues`.

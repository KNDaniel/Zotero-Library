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
- [x] Revisa versión `0.9.9` en `package.json` y `manifest.json`; `release:prepare` comprueba igualdad, formato, descripción e `isDesktopOnly`.
- [x] Se revisaron `CHANGELOG.md`, los enlaces y la captura autorizada en README.
- [x] `node scripts/release-package.mjs verify dist/zotero-library-0.9.9` exige `README.md`, `CHANGELOG.md`, `THIRD-PARTY-NOTICES.md` y `LICENSE`.
- [x] Smoke del bundle, vista, sincronización, salida y escala: pasan con datos sintéticos.
- [x] El directorio candidato contiene solo los tres archivos de instalación; la bóveda de aceptación está fuera de él.
- [x] Piloto local de instalación, actualización, reinstalación y primer arranque completado con datos sintéticos.
- [ ] Publica `main.js`, `manifest.json` y `styles.css` en el release `0.9.9`, con etiqueta exacta `0.9.9` (sin prefijo `v`).
- [ ] CI del tag `0.9.9`: matriz Windows/macOS/Linux, build reproducible, verificación del candidato y atestación de artefactos aprobados.

La verificación automática valida SemVer estable `x.y.z`, la igualdad de versiones, las condiciones básicas del manifiesto y la lista exacta de archivos permitidos. La presencia de `LICENSE` no determina que su texto sea legalmente adecuado ni que GitHub vaya a clasificarlo correctamente; el titular debe comprobarlo.

## Estado actual

- Release `0.9.8`: versión publicada y vigente; `0.9.9` en preparación con correcciones de seguridad, compatibilidad y tipos.
- README, changelog y captura: preparados; la captura usa los datos que el titular autorizó como no sensibles.
- Licencia: MIT, elegida por el titular; la puerta de publicación ya no depende de esta decisión.
- Para `0.9.9`: 459 pruebas, typecheck, build, cinco smoke, `release:prepare` y `release:verify` pasan en Windows. CI multiplataforma, atestación y revisión comunitaria quedan pendientes de la publicación.
- Prueba visual en Obsidian de `0.9.6`: completada en `vault-pruebas-fase4`; las pruebas automatizadas del bundle `0.9.7` no sustituyen una prueba manual de instalación de esta versión.
- Piloto local de Fase 5: completado; no participaron usuarios externos. El informe registra alcance, resultados y límites.
- Dirección de soporte: `https://github.com/KNDaniel/zotero-library/issues`.

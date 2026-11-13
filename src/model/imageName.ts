import type { ZoteroAnnotation } from "./types";

/**
 * Las anotaciones de imagen se guardan con un nombre del tipo
 * `<claveAdjunto>-<página>-x<x>-y<y>`. Zotero no entrega esos números ya
 * calculados: salen de `annotationPosition`. Se conservan todas las variantes
 * probadas para que el informe de verificación pueda volver a comprobarlas.
 */
export interface ImageNameStrategy {
  id: string;
  pageOffset: 0 | 1;
  xFrom: "x1" | "x2";
  yFrom: "y1" | "y2";
  rounding: "round" | "floor";
}

export interface ImageParts {
  page: number;
  x: number;
  y: number;
}

export const IMAGE_NAME_STRATEGIES: ImageNameStrategy[] = [];
for (const pageOffset of [1, 0] as const) {
  for (const xFrom of ["x1", "x2"] as const) {
    for (const yFrom of ["y2", "y1"] as const) {
      for (const rounding of ["round", "floor"] as const) {
        IMAGE_NAME_STRATEGIES.push({
          id: `p+${pageOffset}|${xFrom}|${yFrom}|${rounding}`,
          pageOffset,
          xFrom,
          yFrom,
          rounding,
        });
      }
    }
  }
}

/**
 * Regla de referencia: página = pageIndex + 1, x = esquina
 * izquierda del primer rectángulo, y = su borde inferior, redondeados.
 * Reproduce ATTACH01-8-x98-y662 y ATTACH01-49-x139-y630.
 */
export const DEFAULT_IMAGE_NAME_ID = "p+1|x1|y1|round";
export const DEFAULT_IMAGE_NAME_STRATEGY: ImageNameStrategy =
  IMAGE_NAME_STRATEGIES.find((s) => s.id === DEFAULT_IMAGE_NAME_ID) ?? IMAGE_NAME_STRATEGIES[0];

export function imageParts(
  annotation: Pick<ZoteroAnnotation, "position">,
  strategy: ImageNameStrategy = DEFAULT_IMAGE_NAME_STRATEGY,
): ImageParts | null {
  const position = annotation.position;
  const rect = position?.rects[0];
  if (!position || !rect || rect.length < 4) return null;
  const round = strategy.rounding === "round" ? Math.round : Math.floor;
  const [x1, y1, x2, y2] = rect;
  return {
    page: position.pageIndex + strategy.pageOffset,
    x: round(strategy.xFrom === "x1" ? x1 : x2),
    y: round(strategy.yFrom === "y1" ? y1 : y2),
  };
}

export function imageBaseName(attachmentKey: string, parts: ImageParts): string {
  return `${attachmentKey}-${parts.page}-x${parts.x}-y${parts.y}`;
}

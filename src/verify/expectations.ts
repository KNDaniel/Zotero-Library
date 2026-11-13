/**
 * Referencias sintéticas para comprobar las reglas candidatas de nombres de imagen.
 *
 * En el segundo caso el número del nombre no coincide con la etiqueta de página.
 */
export interface ImageNameExpectation {
  annotationKey: string;
  /** Nombre sin extensión ni carpeta */
  expected: string;
  note: string;
}

export const IMAGE_NAME_EXPECTATIONS: ImageNameExpectation[] = [
  { annotationKey: "ANN00001", expected: "ATTACH01-8-x98-y662", note: "página 8 de la muestra sintética" },
  { annotationKey: "ANN00002", expected: "ATTACH01-49-x139-y630", note: "página 49 de la muestra sintética" },
];

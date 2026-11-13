import { describe, expect, it } from "vitest";
import { colorCategoryOf } from "../src/model/colors";
import { toIsoDate } from "../src/model/dates";
import { DEFAULT_IMAGE_NAME_STRATEGY, IMAGE_NAME_STRATEGIES, imageBaseName, imageParts } from "../src/model/imageName";
import { normalizeEntity, parsePosition, relatedItemKeys } from "../src/model/normalize";
import type { ZoteroAttachment, ZoteroItem, ZoteroAnnotation } from "../src/model/types";
import { annotation, attachment, item } from "./fixtures";

describe("colores", () => {
  it("reconoce los ocho estándar", () => {
    expect(colorCategoryOf("#ffd400")).toEqual({ category: "yellow", exact: true });
    expect(colorCategoryOf("#FF6666")).toEqual({ category: "red", exact: true });
    expect(colorCategoryOf("#aaaaaa")).toEqual({ category: "gray", exact: true });
    expect(colorCategoryOf("")).toEqual({ category: "", exact: false });
  });
  it("clasifica por tono los colores no estándar de tu biblioteca", () => {
    expect(colorCategoryOf("#8df0fd")).toEqual({ category: "blue", exact: false }); // cian claro
    expect(colorCategoryOf("#339e00")).toEqual({ category: "green", exact: false });
    expect(colorCategoryOf("#ffed00")).toEqual({ category: "yellow", exact: false });
    expect(colorCategoryOf("#ffc0cb")).toEqual({ category: "red", exact: false }); // rosa
    expect(colorCategoryOf("#808080")).toEqual({ category: "gray", exact: false });
  });
});

describe("fechas", () => {
  it("completa fechas parciales con 01", () => {
    expect(toIsoDate("2010-06")).toBe("2010-06-01");
    expect(toIsoDate("2010")).toBe("2010-01-01");
    expect(toIsoDate("2010-06-15")).toBe("2010-06-15");
    expect(toIsoDate("2010-00-00")).toBe("2010-01-01");
  });
  it("usa el texto libre si no hay parsedDate", () => {
    expect(toIsoDate(undefined, "1867-09-14")).toBe("1867-09-14");
    expect(toIsoDate(undefined, "junio de 2010")).toBe("2010-01-01");
    expect(toIsoDate(undefined, "sin fecha")).toBeUndefined();
  });
});

describe("normalización de ítems", () => {
  const it0 = normalizeEntity(item("ABCD1234")) as ZoteroItem;
  it("conserva todos los campos escalares y el objeto crudo", () => {
    expect(it0.kind).toBe("item");
    expect(it0.fields.publisher).toBe("Siglo Veintiuno");
    expect(it0.fields.ISBN).toBe("978-84-323-1592-3");
    expect(it0.fields.dateAdded).toBe("2024-01-01T00:00:00Z");
    expect(it0.raw.data.publisher).toBe("Siglo Veintiuno");
  });
  it("normaliza creadores, etiquetas y fecha", () => {
    expect(it0.creators.map((c) => c.creatorType)).toEqual(["author", "translator"]);
    expect(it0.tags).toEqual([{ tag: "marxismo", type: 0 }]);
    expect(it0.isoDate).toBe("2010-06-01");
    expect(it0.year).toBe(2010);
    expect(it0.creatorSummary).toBe("Marx");
  });
  it("tolera relations como [] y campos ausentes", () => {
    const e = normalizeEntity(item("ABCD1235", { relations: [], creators: undefined, tags: undefined })) as ZoteroItem;
    expect(e.relations).toEqual({});
    expect(e.creators).toEqual([]);
    expect(e.tags).toEqual([]);
  });
  it("extrae las claves de ítems relacionados", () => {
    expect(
      relatedItemKeys({ "dc:relation": ["http://zotero.org/users/123/items/6Y8BC9A2", "otra cosa"] }),
    ).toEqual(["6Y8BC9A2"]);
  });
});

describe("normalización de adjuntos y anotaciones", () => {
  it("adjunto con y sin padre", () => {
    const a = normalizeEntity(attachment("ATTACH01", "ABCD1234")) as ZoteroAttachment;
    const s = normalizeEntity(attachment("SOLO1234", null)) as ZoteroAttachment;
    expect(a.parentKey).toBe("ABCD1234");
    expect(s.parentKey).toBeNull();
    expect(a.filename).toBe("ATTACH01.pdf");
  });
  it("anotación: campos amigables y crudos", () => {
    const a = normalizeEntity(annotation("ANN00001", "ATTACH01", { annotationColor: "#FFD400" })) as ZoteroAnnotation;
    expect(a.type).toBe("highlight");
    expect(a.text).toBe("texto subrayado");
    expect(a.color).toBe("#ffd400");
    expect(a.colorCategory).toBe("yellow");
    expect(a.colorExact).toBe(true);
    expect(a.pageLabel).toBe("VIII");
    expect(a.fields.annotationText).toBe("texto subrayado");
    expect(a.position?.pageIndex).toBe(7);
  });
  it("posición inválida no rompe la normalización", () => {
    expect(parsePosition("{no es json")).toBeNull();
    expect(parsePosition({ rects: [] })).toBeNull();
    const a = normalizeEntity(annotation("BAD00001", "ATTACH01", { annotationPosition: "xx" })) as ZoteroAnnotation;
    expect(a.position).toBeNull();
  });
});

describe("nombre de imagen", () => {
  // Datos reales de tu informe de verificación.
  const real1 = { position: { pageIndex: 7, rects: [[98, 661.9, 481.2, 696.9]] } };
  const real2 = { position: { pageIndex: 48, rects: [[138.929, 629.643, 437.571, 701.357]] } };

  it("la regla por defecto reproduce tus dos nombres de referencia", () => {
    expect(DEFAULT_IMAGE_NAME_STRATEGY.id).toBe("p+1|x1|y1|round");
    expect(imageBaseName("ATTACH01", imageParts(real1)!)).toBe("ATTACH01-8-x98-y662");
    expect(imageBaseName("ATTACH01", imageParts(real2)!)).toBe("ATTACH01-49-x139-y630");
  });

  it("de todas las reglas probadas solo esa reproduce ambos nombres", () => {
    const matching = IMAGE_NAME_STRATEGIES.filter(
      (s) =>
        imageBaseName("ATTACH01", imageParts(real1, s)!) === "ATTACH01-8-x98-y662" &&
        imageBaseName("ATTACH01", imageParts(real2, s)!) === "ATTACH01-49-x139-y630",
    );
    expect(matching.map((s) => s.id)).toEqual(["p+1|x1|y1|round"]);
  });

  it("sin rectángulo devuelve null y los ids son únicos", () => {
    expect(new Set(IMAGE_NAME_STRATEGIES.map((s) => s.id)).size).toBe(IMAGE_NAME_STRATEGIES.length);
    expect(imageParts({ position: { pageIndex: 1, rects: [] } })).toBeNull();
  });
});

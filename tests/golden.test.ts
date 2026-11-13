import moment from "moment";
import { describe, expect, it } from "vitest";
import { LibraryIndex } from "../src/index/LibraryIndex";
import { DEFAULT_IMAGE_NAME_TEMPLATE, itemContext, type ContextOptions } from "../src/template/context";
import { TemplateEngine, type MomentFn } from "../src/template/engine";
import { ITEM_KEY, golden, goldenEntities, note, template } from "./goldenData";

/** Prueba de oro: los datos sintéticos reproducen la salida esperada byte a byte. */
const index = LibraryIndex.fromRaw({ entities: goldenEntities(), collections: [], libraryVersion: 1, total: 0, truncated: false });
const engine = new TemplateEngine({ moment: moment as unknown as MomentFn });
const opts: ContextOptions = {
  dataDir: golden.dataDir,
  imagesFolder: "Recursos/Img. Titulos",
  imageNameTemplate: DEFAULT_IMAGE_NAME_TEMPLATE,
  renderString: (t, c) => engine.render(t, c),
};

function render(): string {
  const item = index.items.get(ITEM_KEY)!;
  const all = index.annotationsOf(ITEM_KEY);
  return engine.render(template, itemContext(index, item, all, all, opts), "import");
}

function firstDifferences(a: string, b: string, max = 6): string {
  const x = a.split("\n");
  const y = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(x.length, y.length) && out.length < max; i++) {
    if (x[i] !== y[i]) out.push(`línea ${i + 1}:\n  obtenido: ${JSON.stringify(x[i])}\n  esperado: ${JSON.stringify(y[i])}`);
  }
  return out.join("\n");
}

describe("prueba de oro con una plantilla de importación", () => {
  it("los datos sintéticos se leen bien", () => {
    expect(index.annotationsOf(ITEM_KEY)).toHaveLength(71);
    expect(index.diagnostics.orphanAnnotations).toEqual([]);
  });

  it("reproduce la salida de referencia byte a byte", () => {
    const out = render();
    if (out !== note) console.log(firstDifferences(out, note));
    expect(out === note, `\n${firstDifferences(out, note)}`).toBe(true);
  });
});

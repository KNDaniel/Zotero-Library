import { describe, expect, it, vi } from "vitest";
import { writeClipboardText } from "../src/clipboard";

describe("escritura explícita al portapapeles", () => {
  it("solo escribe el texto recibido y propaga fallos", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    await writeClipboardText("salida", { writeText });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("salida");
    await expect(writeClipboardText("x", { writeText: async () => { throw new Error("denegado"); } })).rejects.toThrow("denegado");
  });

  it("falla con un mensaje claro si el portapapeles no está disponible", async () => {
    await expect(writeClipboardText("salida", undefined)).rejects.toThrow(/no está disponible/);
  });
});

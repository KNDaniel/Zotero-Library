export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/** Solo escribe cuando una acción explícita pide copiar; nunca lee el portapapeles. */
export async function writeClipboardText(text: string, writer?: ClipboardWriter): Promise<void> {
  const clipboard = writer ?? (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
  if (!clipboard?.writeText) throw new Error("El portapapeles no está disponible en este entorno.");
  await clipboard.writeText(text);
}

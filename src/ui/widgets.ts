/** Controles pequeños reutilizados por los paneles (solo DOM, sin depender de Obsidian). */

export interface Segmented<T extends string> {
  el: HTMLElement;
  /** null deja todas las opciones sin marcar */
  set(value: T | null): void;
}

export function segmented<T extends string>(
  parent: HTMLElement,
  options: Array<{ value: T; label: string; title?: string }>,
  onPick: (value: T) => void,
): Segmented<T> {
  const el = parent.createDiv({ cls: "zl-seg" });
  const buttons = new Map<T, HTMLElement>();
  for (const o of options) {
    const b = el.createEl("button", { cls: "zl-seg-btn", text: o.label, attr: { type: "button", ...(o.title ? { title: o.title } : {}) } });
    b.addEventListener("click", () => onPick(o.value));
    buttons.set(o.value, b);
  }
  return {
    el,
    set(value: T | null) {
      for (const [v, b] of buttons) b.toggleClass("is-active", v === value);
    },
  };
}

export function actionButton(parent: HTMLElement, text: string, onClick: () => void, title?: string): HTMLElement {
  const b = parent.createEl("button", { cls: "zl-btn", text, attr: { type: "button", ...(title ? { title } : {}) } });
  b.addEventListener("click", onClick);
  return b;
}

export interface SelectControl<T extends string> {
  el: HTMLSelectElement;
  set(value: T): void;
}

export function selectControl<T extends string>(
  parent: HTMLElement,
  options: Array<{ value: T; label: string }>,
  onChange: (value: T) => void,
): SelectControl<T> {
  const el = parent.createEl("select", { cls: "dropdown zl-select" });
  for (const o of options) el.createEl("option", { text: o.label, value: o.value });
  el.addEventListener("change", () => onChange(el.value as T));
  return {
    el,
    set(value: T) {
      if (el.value !== value) el.value = value;
    },
  };
}

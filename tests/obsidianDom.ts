/** Reproduce en jsdom los ayudantes de DOM que Obsidian añade a HTMLElement. */
interface Info {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  type?: string;
  value?: string;
  placeholder?: string;
  title?: string;
}

export function installObsidianDom(win: Window & typeof globalThis): void {
  const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.createEl = function (this: HTMLElement, tag: string, info?: string | Info, cb?: (el: HTMLElement) => void) {
    const o: Info = typeof info === "string" ? { cls: info } : (info ?? {});
    const el = this.ownerDocument.createElement(tag);
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
    if (o.text !== undefined) el.textContent = o.text;
    if (o.type) el.setAttribute("type", o.type);
    if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
    if (o.placeholder) el.setAttribute("placeholder", o.placeholder);
    if (o.title) el.setAttribute("title", o.title);
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v !== null) el.setAttribute(k, String(v));
    this.appendChild(el);
    cb?.(el);
    return el;
  };
  proto.createDiv = function (this: HTMLElement, info?: string | Info, cb?: (el: HTMLElement) => void) {
    return (this as unknown as { createEl: Function }).createEl("div", info, cb);
  };
  proto.createSpan = function (this: HTMLElement, info?: string | Info, cb?: (el: HTMLElement) => void) {
    return (this as unknown as { createEl: Function }).createEl("span", info, cb);
  };
  proto.empty = function (this: HTMLElement) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  proto.addClass = function (this: HTMLElement, ...c: string[]) {
    this.classList.add(...c);
  };
  proto.removeClass = function (this: HTMLElement, ...c: string[]) {
    this.classList.remove(...c);
  };
  proto.toggleClass = function (this: HTMLElement, c: string | string[], v: boolean) {
    for (const k of Array.isArray(c) ? c : [c]) this.classList.toggle(k, v);
  };
  proto.hasClass = function (this: HTMLElement, c: string) {
    return this.classList.contains(c);
  };
  proto.setText = function (this: HTMLElement, t: string) {
    this.textContent = t;
  };
  proto.setCssStyles = function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  };
  proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
  };
}

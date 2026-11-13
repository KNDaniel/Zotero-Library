// jsdom con los ayudantes de DOM de Obsidian (createEl, empty, addClass…), para las pruebas de humo.
import { JSDOM } from "jsdom";

export function installDom() {
  const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, Event: window.Event, MouseEvent: window.MouseEvent });
  const proto = window.HTMLElement.prototype;
  proto.createEl = function (tag, info, cb) {
    const o = typeof info === "string" ? { cls: info } : info ?? {};
    const el = this.ownerDocument.createElement(tag);
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
    if (o.text !== undefined) el.textContent = o.text;
    if (o.type) el.setAttribute("type", o.type);
    if (o.value !== undefined) el.value = o.value;
    if (o.placeholder) el.setAttribute("placeholder", o.placeholder);
    if (o.title) el.setAttribute("title", o.title);
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v !== null) el.setAttribute(k, String(v));
    this.appendChild(el);
    cb?.(el);
    return el;
  };
  proto.createDiv = function (i, cb) { return this.createEl("div", i, cb); };
  proto.createSpan = function (i, cb) { return this.createEl("span", i, cb); };
  proto.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  proto.addClass = function (...c) { this.classList.add(...c); };
  proto.removeClass = function (...c) { this.classList.remove(...c); };
  proto.toggleClass = function (c, v) { for (const k of Array.isArray(c) ? c : [c]) this.classList.toggle(k, v); };
  proto.setText = function (t) { this.textContent = t; };
  return window;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
export const $ = (sel, scope = document) => scope.querySelector(sel);
export const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];

import * as nunjucks from "nunjucks";

/** Lo mínimo que se usa de moment (en Obsidian se inyecta el `moment` incluido). */
export interface MomentLike {
  format(fmt: string): string;
  isAfter(other: unknown): boolean;
  isBefore(other: unknown): boolean;
  isSame(other: unknown, unit?: string): boolean;
  isValid(): boolean;
}
export type MomentFn = (input?: unknown) => MomentLike;

export interface EngineOptions {
  moment: MomentFn;
  /** Plantillas disponibles para {% include %} / {% import %} / {% extends %}, por nombre o ruta */
  templates?: Map<string, string>;
}

export class TemplateError extends Error {
  constructor(message: string, public readonly templateName?: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * Motor Nunjucks con la misma configuración que necesitan tus plantillas:
 * sin autoescape (el HTML de Zotero pasa tal cual) y con los filtros `format`
 * y `filterby` de Zotero Integration.
 */
export class TemplateEngine {
  private templates: Map<string, string>;
  private readonly env: nunjucks.Environment;
  /** Cada texto de plantilla se compila una sola vez (renderString lo compila en cada llamada) */
  private compiled = new Map<string, nunjucks.Template>();
  /** El cargador de plantillas incluidas ({% include %}); Nunjucks guarda en él las que ya compiló */
  private readonly loader: { cache?: Record<string, unknown> };

  constructor(private readonly opts: EngineOptions) {
    this.templates = opts.templates ?? new Map();
    const lookup = (name: string): string | undefined => {
      const clean = name.replace(/^\.?\//, "");
      return this.templates.get(clean) ?? this.templates.get(`${clean}.md`) ?? this.templates.get(`${clean}.njk`);
    };
    const loader = {
      async: false,
      getSource: (name: string) => {
        const src = lookup(name);
        return src === undefined ? null : { src, path: name, noCache: false };
      },
    };
    this.loader = loader as { cache?: Record<string, unknown> };
    this.env = new nunjucks.Environment(loader as unknown as nunjucks.ILoader, {
      autoescape: false,
      throwOnUndefined: false,
      trimBlocks: false,
      lstripBlocks: false,
    });
    this.registerFilters();
  }

  setTemplates(templates: Map<string, string>): void {
    this.templates = templates;
    this.compiled.clear();
    this.loader.cache = {}; // Nunjucks asigna su propia caché al cargador: se sustituye entera
  }

  private registerFilters(): void {
    const { moment } = this.opts;

    // {{ date | format("YYYY-MM-DD") }}
    this.env.addFilter("format", (value: unknown, fmt: string) => (value === undefined || value === null || value === "" ? "" : moment(value).format(fmt)));

    // {{ annotations | filterby("date", "dateafter", lastImportDate) }}
    this.env.addFilter("filterby", (list: unknown, prop: string, comparison: string, value: unknown) => {
      if (!Array.isArray(list)) return [];
      const cmp = String(comparison).toLowerCase();
      const needle = String(value ?? "").toLowerCase();
      return list.filter((entry) => {
        const v = (entry as Record<string, unknown>)?.[prop];
        switch (cmp) {
          case "contains":
            return String(v ?? "").toLowerCase().includes(needle);
          case "startswith":
            return String(v ?? "").toLowerCase().startsWith(needle);
          case "endswith":
            return String(v ?? "").toLowerCase().endsWith(needle);
          case "dateafter":
            return moment(v).isAfter(moment(value));
          case "datebefore":
            return moment(v).isBefore(moment(value));
          case "dateon":
            return moment(v).isSame(moment(value), "day");
          default:
            return false;
        }
      });
    });
  }

  /** Renderiza el texto de una plantilla con el contexto dado. */
  render(source: string, context: object, name?: string): string {
    try {
      let tpl = this.compiled.get(source);
      if (!tpl) {
        tpl = new nunjucks.Template(source, this.env, undefined, true);
        if (this.compiled.size >= 200) this.compiled.clear();
        this.compiled.set(source, tpl);
      }
      return tpl.render(context as Record<string, unknown>);
    } catch (e) {
      throw new TemplateError((e as Error).message, name);
    }
  }
}

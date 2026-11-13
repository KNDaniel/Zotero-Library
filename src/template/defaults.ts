/**
 * Plantillas de renderizado incluidas: se usan mientras no elijas otras en los
 * ajustes. Son solo para las tarjetas del panel de resultados.
 */
export const DEFAULT_ITEM_RENDER = `**{{ title }}**
{%- if authors %}  
{{ authors }}{% if year %} ({{ year }}){% endif %}{% endif %}
{%- if publicationTitle or bookTitle %}  
*{{ publicationTitle or bookTitle }}*{% endif %}
{%- if publisher %}  
{{ publisher }}{% if place %}, {{ place }}{% endif %}{% endif %}
{%- if allTags %}  
Etiquetas: {{ allTags }}{% endif %}
{%- if abstractNote %}

> {{ abstractNote | replace("\\n", "\\n> ") }}
{%- endif %}

[Zotero]({{ openURI }}){% if localURI %} · [Local]({{ localURI }}){% endif %}
`;

export const DEFAULT_ANNOTATION_RENDER = `{% if annotation.annotatedText %}> {{ annotation.annotatedText }}

{% endif %}{% if annotation.imageRelativePath %}![[{{ annotation.imageRelativePath }}|300]]

{% endif %}{% if annotation.comment %}{{ annotation.comment }}

{% endif %}<small>{{ authors or "s. a." }}{% if year %} ({{ year }}){% endif %}, *{{ title }}*{% if annotation.desktopURI %}, [{% if annotation.pageLabel %}p. {{ annotation.pageLabel }}{% else %}abrir{% endif %}]({{ annotation.desktopURI }}){% elif annotation.pageLabel %}, p. {{ annotation.pageLabel }}{% endif %}</small>
`;

/**
 * Plantillas de impresión incluidas (copiar, insertar en nota, nueva nota).
 * Se usan mientras no elijas otras en los ajustes o en la barra de salida.
 */
export const DEFAULT_PRINT_META = `## {{ title }}
{%- if authors %}

{{ authors }}{% if year %} ({{ year }}){% endif %}{% endif %}
{%- if publicationTitle or bookTitle %}

*{{ publicationTitle or bookTitle }}*{% endif %}
{%- if publisher %}

{{ publisher }}{% if place %}, {{ place }}{% endif %}{% endif %}
{%- if allTags %}

Etiquetas: {{ allTags }}{% endif %}
{%- if abstractNote %}

> {{ abstractNote | replace("\\n", "\\n> ") }}{% endif %}

[Zotero]({{ openURI }}){% if localURI %} · [Local]({{ localURI }}){% endif %}
`;

export const DEFAULT_PRINT_ANNOTATIONS = DEFAULT_ANNOTATION_RENDER;

export const DEFAULT_PRINT_FULL = `${DEFAULT_PRINT_META}
{% for annotation in annotations %}
{% if annotation.annotatedText %}> {{ annotation.annotatedText }}

{% endif %}{% if annotation.imageRelativePath %}![[{{ annotation.imageRelativePath }}|300]]

{% endif %}{% if annotation.comment %}{{ annotation.comment }}

{% endif %}<small>{% if annotation.desktopURI %}[{% if annotation.pageLabel %}p. {{ annotation.pageLabel }}{% else %}abrir{% endif %}]({{ annotation.desktopURI }}){% elif annotation.pageLabel %}p. {{ annotation.pageLabel }}{% endif %}{% if annotation.tags.length %} · {% for t in annotation.tags %}{{ t.tag }}{% if not loop.last %}, {% endif %}{% endfor %}{% endif %}</small>

{% endfor %}`;

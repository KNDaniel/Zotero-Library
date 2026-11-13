{%- set colorCategoryToMeaning ={
	"yellow": "Relevante",
	"red": "Contradictorio",
	"green": "Contexto",
	"blue": "Hechos",
	"purple": "Párrafo",
	"magenta": "Referencias",
	"orange": "Delimitaciones",
	"gray": "Otros"
}-%}


{%- macro getMeaning(colorCategory) -%}
	{%- if colorCategory-%}
		{{- colorCategoryToMeaning[colorCategory] | default("Sin categoría definida") -}}
	{%- endif -%}
{%- endmacro -%}


{%- macro printTags(rawTags, zoteroKey) -%}
	{%- if rawTags and rawTags.length > 0 and zoteroKey -%}
		{%- for tag in rawTags -%}
				#[[Recursos/Términos/{{tag.tag}} - ({{zoteroKey}})|{{tag.tag}}]] {{ ' ' }}
		{%- endfor -%}
	{%- endif -%}
{%- endmacro -%}


{%- set translator = null -%}
{%- for c in creators -%}
  {%- if c.creatorType == "translator" and not translator -%}
    {%- set translator = c -%}
  {%- endif -%}
{%- endfor -%}


{%- set firstAttachment = attachments[0] if attachments and attachments.length > 0 else null -%}


{%- set frontmatter_fields = {
"obra fuente": "undefined",
"autores": "\n- " ~ (authors | replace(",", "\n-")) if authors and authors != "[undefined]" else "",
"editores": "\n- " ~ (editors | replace(",", "\n-")) if editors and editors != "[undefined]" else "",
"directores": "\n- " ~ (directors | replace(",", "\n-")) if directors and directors != "[undefined]" else "",
"traductores": "\n- " ~ (translators | replace(",", "\n-")) if translators and translators != "[undefined]" else "",
"tags": "\n- " ~ (allTags | replace(",", "\n-")) if allTags and allTags != "[undefined]" else "",
"edicion n.": edition,
"f. publicacion": date | format("YYYY-MM-DD"),
"volumen": volume,
"total volumenes": numberOfVolumes,
"editorial": publisher,
"pages": numPages,
"idioma": language,
"url": url,
"isbn": ISBN,
"zoteroID": firstAttachment.itemKey if firstAttachment else "",
"clase n": "Recursos",
"tipo n": "Anotaciones"
}-%}


{%- macro generateField(prefix, delimiter, f, p) -%}
{%- if p -%}
{{prefix}}{{f}}{{delimiter}}{{p}}
{% endif %}
{%- endmacro -%}


{%- macro generateFields(prefix, delimiter, fields) -%}
{%- for field, property in fields -%}
{{- generateField(prefix, delimiter, field, property) -}}
{%- endfor -%}
{%- endmacro -%}


---
{% if shortTitle -%}
aliases:
- "{{ shortTitle ~ ( " (" ~ translator.lastName ~ ")" if translator else "" ) }}"
- {{ firstAttachment.itemKey if firstAttachment else "" }}
{%- else -%}
aliases: 
- "{{ title ~ ( " (" ~ translator.lastName ~ ")" if translator else "" ) }}"
- {{ firstAttachment.itemKey if firstAttachment else "" }}
{%- endif %}
titulo: "{{ title ~ ( " (" ~ translator.lastName ~ ")" if translator else "" ) }}"
{{generateFields("",": ",frontmatter_fields) -}}
---


> [!info]- Metadata
{%- if firstAttachmentZoteroLink %}
> **Zotero**: {{firstAttachmentZoteroLink}}  
{%- endif -%}
{% if firstAttachmentLink %}  
> **Local**: {{ firstAttachmentLink | replace("\\", "/") }}  
{% endif -%}
{%- if extra -%}
> {{extra}}  
{% endif -%}
>
>> [!NOTE]- Abstract
{% if abstractNote and abstractNote.length > 0 -%}
>> {{ abstractNote | replace("\n", "\n>> ") }}
{%- else -%}
>> No se encontró abstract disponible.
{%- endif -%}
{% if relations.length > 0 %}
>
>> [!note]- Relacionado:
>> | Título | Autor(es) | Enlace |
>> | --- | --- | --- |
{%- for r in relations %}
>> | {{ r.title | replace("|", "❕") }} | {% if r.creators and r.creators.length > 0 %}{{ r.creators[0].lastName }}, {{ r.creators[0].firstName }}{% else %}Autor no disponible{% endif %} | [🔗 Zotero]({{ r.desktopURI }}) |
{%- endfor -%}
{%- else %}
>
>> [!note]- Relacionado:
>> No se encontraron documentos relacionados.
{%- endif -%}
{{ "" }} 
>>

**<center>Anotaciones.</center>**

{%- set newAnnotations = annotations if not lastImportDate else annotations | filterby("date", "dateafter", lastImportDate) -%}
{% if newAnnotations.length > 0 %}
{%- set noteIndex = 1 -%}
{% for annotation in newAnnotations %}
{%- set citationLink = '[Zotero](zotero://open-pdf/library/items/' ~ annotation.attachment.itemKey ~ '?page=' ~ annotation.pageLabel ~ '&annotation=' ~ annotation.id ~ ')' %}
{% if annotation.type == "note" and annotation.colorCategory | lower == "purple" %}
> [!zotero-{{annotation.colorCategory | lower}}] {{getMeaning(annotation.colorCategory | lower)}} n. {{ noteIndex }} {%- set noteIndex = noteIndex + 1 %} <br> N. {{ loop.index }} {{annotation.type|capitalize}} <br> {{ annotation.id }}
{%- else %}
> [!zotero-{{annotation.colorCategory | lower}}] {{ getMeaning(annotation.colorCategory | lower) }} <br> N. {{ loop.index }} {{annotation.type|capitalize | truncate(5)}} <br> {{ annotation.id }}
{%- endif %}
{%- if annotation.tags.length > 0 %}
🏷 - {{printTags(annotation.tags, firstAttachment.itemKey if firstAttachment else "")  }}
{%- endif %}
{%- if annotation.annotatedText.length > 0 %}  
✒ - {{annotation.annotatedText}}  
{%- endif %}
{%- if annotation.imageRelativePath %}  
> ![[{{annotation.imageRelativePath}}|300]]  
{%- endif %}
{%- if annotation.desktopURI %}  
🔎 - ([p. {{annotation.pageLabel}}]({{annotation.desktopURI}}))  
{%- else %}
🔎 - {{citationLink}}  
{%- endif %}
{%- if annotation.comment %}  
✏ - *Comentarios*:  
{{annotation.comment | replace ("\n", "\n> ") | replace ("--", "\t-")  }}
{%- endif -%}
{{" "}}
^{{ annotation.id }}
{% endfor %}
{%- endif -%}
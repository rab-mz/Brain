// CodeMirror 6 setup. This module is ONLY ever loaded via dynamic import
// from CodeBlock.svelte / NoteBlock.svelte, so none of it lands in the
// initial bundle.

import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  Decoration,
  WidgetType,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import {
  EditorState,
  Compartment,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension
} from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
  syntaxTree
} from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { tags } from '@lezer/highlight'
import type { SyntaxNode } from '@lezer/common'
import { get } from 'svelte/store'
import { showToast } from '../stores'
import { showMenu } from '../menu'
import { FORMATS, renderInlineMarkdown } from '../format'
import {
  deleteColumn,
  deleteRow,
  emptyTable,
  insertColumn,
  insertRow,
  parseTable,
  serializeTable,
  setAlign,
  tidyTable,
  toGrid,
  unflattenTable,
  type Align,
  type ParsedTable
} from '../table'
import { t } from '../i18n'

async function languageExtension(language: string): Promise<Extension> {
  const lang = language.toLowerCase()
  if (lang === 'sql') return (await import('@codemirror/lang-sql')).sql()
  if (['js', 'jsx', 'javascript'].includes(lang)) {
    return (await import('@codemirror/lang-javascript')).javascript({ jsx: lang === 'jsx' })
  }
  if (['ts', 'tsx', 'typescript'].includes(lang)) {
    return (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: lang === 'tsx' })
  }
  if (lang === 'json') return (await import('@codemirror/lang-json')).json()
  return []
}

const lightTheme: Extension = syntaxHighlighting(defaultHighlightStyle)

export interface BrainEditor {
  setDark(dark: boolean): void
  destroy(): void
}

/** Editor for sql/code blocks: syntax highlighting, dark/light theme. */
export async function createEditor(
  parent: HTMLElement,
  opts: {
    code: string
    language: string
    dark: boolean
    onChange(code: string): void
  }
): Promise<BrainEditor> {
  const themeCompartment = new Compartment()
  const lang = await languageExtension(opts.language)

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.code,
      extensions: [
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        lang,
        themeCompartment.of(opts.dark ? oneDark : lightTheme),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) opts.onChange(update.state.doc.toString())
        })
      ]
    })
  })

  return {
    setDark(dark: boolean) {
      view.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : lightTheme) })
    },
    destroy() {
      view.destroy()
    }
  }
}

// ---------- Note editor: the zen-like continuous markdown surface ----------

const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"

// Live markdown styling: **bold** renders bold, *italic* italic, headings
// larger, while the text stays plain editable Markdown.
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.3em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.15em', fontWeight: '700' },
  { tag: tags.heading4, fontWeight: '700' },
  { tag: tags.strong, fontWeight: '700' },
  // Italic alone is nearly invisible in system-ui: a bit of weight makes
  // emphasis actually stand out from the surrounding prose.
  { tag: tags.emphasis, fontStyle: 'italic', fontWeight: '500' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  // `inline code` as a Slack-style pill: tinted mono text on its own
  // background, clearly separate from prose (and from italic).
  {
    tag: tags.monospace,
    fontFamily: MONO,
    fontSize: '0.9em',
    color: 'var(--inline-code-fg)',
    backgroundColor: 'var(--inline-code-bg)',
    borderRadius: '4px',
    padding: '1px 4px'
  },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--accent)' },
  { tag: tags.quote, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: 'var(--muted)' },
  { tag: tags.contentSeparator, color: 'var(--muted)' }
])

const noteTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '15px' },
  // Lines wrap, so horizontal scrolling never carries information — but the
  // drawn cursor can poke 1px past the content for a frame while typing at
  // the right edge, flashing the overlay scrollbar. Clip instead of scroll.
  '.cm-scroller': { overflowX: 'hidden' },
  '.cm-content': {
    fontFamily: 'var(--doc-font)',
    lineHeight: '1.65',
    // 2px on the right keeps the drawn caret visible at the edge.
    padding: '2px 2px 2px 0',
    caretColor: 'var(--fg)',
    // The base theme's scroller is a flex row with align-items: flex-start,
    // which shrinks the content to the longest line when every line is
    // short — and anything 100%-wide inside (the --- separator) shrinks
    // with it. Notes always span the full column.
    minWidth: '100%'
  },
  '.cm-line': { padding: '0' },
  // Padding, not margin: CodeMirror measures line heights from padding-box.
  '.cm-line.cm-heading-line': { paddingTop: '0.7em' },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--muted)' }
})

// ---------- Inline images ----------

/** Resolves an image src (usually a path relative to the document) to a URL. */
export type ImageResolver = (src: string) => Promise<string | null>

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

// Video and document files reuse the ![alt](src) image syntax — the
// extension decides which widget renders, so the markdown stays readable
// outside the app.
const VIDEO_SRC_RE = /\.(mp4|mov|m4v|webm)$/i
const FILE_SRC_RE = /\.(pdf|csv)$/i
const FILE_MIME: Record<'pdf' | 'csv', string> = { pdf: 'application/pdf', csv: 'text/csv' }

// Marks a drag that started from one of our own file cards, so the in-app
// drop handlers (below and in DocView) can tell it apart from a real file
// drag and not re-import the file. Duplicated in DocView.svelte on purpose:
// importing it from here would pull CodeMirror into the initial bundle.
const BRAIN_FILE_DRAG = 'application/x-brain-file'

/** Media (image, video, pdf, csv) accepted by paste/drop. Some drags arrive
 *  with an empty MIME type, so the filename extension is the fallback. */
export function isMediaFile(file: File): boolean {
  return (
    file.type.startsWith('image/') ||
    file.type.startsWith('video/') ||
    file.type === 'application/pdf' ||
    file.type === 'text/csv' ||
    VIDEO_SRC_RE.test(file.name) ||
    FILE_SRC_RE.test(file.name)
  )
}

// Chrome's native "Copy image" re-fetches the src internally and silently
// fails on blob: URLs inside contenteditable, so the widget shows its own
// menu item and writes the clipboard through the Clipboard API instead.
// The clipboard only accepts PNG, so other formats go through a canvas.
function copyImage(img: HTMLImageElement): Promise<void> {
  const png = (async () => {
    const blob = await (await fetch(img.src)).blob()
    if (blob.type === 'image/png') return blob
    const bmp = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bmp.width, bmp.height)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    bmp.close()
    return canvas.convertToBlob({ type: 'image/png' })
  })()
  // Promise-based ClipboardItem: the write starts inside the user gesture
  // even though the PNG is still being produced.
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

// The floating menu itself lives in ../menu (shared with the todo blocks).
const showMediaMenu = showMenu

function copyImageWithToast(img: HTMLImageElement): void {
  copyImage(img).then(
    () => showToast(get(t)('toast.imgCopied')),
    () => showToast(get(t)('toast.copyFail'))
  )
}

/** Remove the media's `![alt](src)` from the document (undoable, file kept). */
function deleteMediaAt(view: EditorView, dom: HTMLElement): void {
  const pos = view.posAtDOM(dom)
  const line = view.state.doc.lineAt(pos)
  IMAGE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMAGE_RE.exec(line.text))) {
    const from = line.from + m.index
    const to = from + m[0].length
    if (pos >= from && pos <= to) {
      view.dispatch({ changes: { from, to } })
      return
    }
  }
}

/** Save a copy of the file through a download link (the clipboard cannot
 *  hold videos or PDFs, so "copy" for those means "download a copy"). */
function downloadFile(src: string, markdownSrc: string): void {
  const a = document.createElement('a')
  a.href = src
  a.download = decodeURI(markdownSrc).split('/').pop() || 'file'
  a.click()
}

/** Open the file in a new tab. CSVs are re-wrapped as text/plain first:
 *  a text/csv blob URL triggers a download instead of rendering. */
async function openFileInTab(url: string, kind: 'pdf' | 'csv'): Promise<void> {
  if (kind === 'pdf') {
    window.open(url, '_blank')
    return
  }
  const blob = await (await fetch(url)).blob()
  window.open(URL.createObjectURL(new Blob([blob], { type: 'text/plain' })), '_blank')
}

/** Copy the raw file to the clipboard. Browsers accept only a short list of
 *  MIME types there, so a refused kind gets a toast pointing at drag&drop,
 *  which does carry the real file into Finder and other apps. */
async function copyFileToClipboard(url: string, kind: 'pdf' | 'csv'): Promise<void> {
  const type = FILE_MIME[kind]
  const supports = (ClipboardItem as { supports?: (t: string) => boolean }).supports
  try {
    if (supports && !supports(type)) throw new Error('unsupported')
    const blob = (async () => new Blob([await (await fetch(url)).blob()], { type }))()
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })])
    showToast(get(t)('toast.copied'))
  } catch {
    showToast(get(t)('toast.fileCopyDrag'))
  }
}

function copyCsvText(url: string): void {
  fetch(url)
    .then((r) => r.text())
    .then((text) => navigator.clipboard.writeText(text))
    .then(
      () => showToast(get(t)('toast.copied')),
      () => showToast(get(t)('toast.copyFail'))
    )
}

/** Overlay on the media's top edge showing its raw markdown on hover, so
 *  the underlying text stays discoverable without any selection logic. */
function addMarkdownCaption(wrap: HTMLElement, alt: string, src: string): void {
  const cap = document.createElement('span')
  cap.className = 'cm-media-caption'
  cap.textContent = `![${alt}](${src})`
  wrap.prepend(cap)
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly resolve: ImageResolver
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-image-widget'
    addMarkdownCaption(wrap, this.alt, this.src)
    const img = document.createElement('img')
    img.alt = this.alt
    img.onload = () => view.requestMeasure()
    if (/^(https?:|data:|blob:)/.test(this.src)) {
      img.src = this.src
    } else {
      void this.resolve(this.src).then((url) => {
        if (url) img.src = url
        else wrap.classList.add('cm-image-missing')
      })
    }
    wrap.appendChild(img)
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showMediaMenu(e.clientX, e.clientY, [
        { label: get(t)('img.copy'), run: () => copyImageWithToast(img) },
        { label: get(t)('media.delete'), run: () => deleteMediaAt(view, wrap) }
      ])
    })
    // Double click = quick copy (the player owns double clicks on videos,
    // so only images get this shortcut).
    wrap.addEventListener('dblclick', (e) => {
      e.preventDefault()
      copyImageWithToast(img)
    })
    // Left-clicking the image must not move any selection: the browser would
    // otherwise place the native selection inside the widget DOM, which maps
    // to no markdown position — CodeMirror falls back to the document start
    // and the page scrolls to the top.
    img.draggable = false
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 2) e.preventDefault()
    })
    return wrap
  }

  // No event on the image may reach CodeMirror: a handled click would move
  // the caret into the markdown and tear the widget down (and right-click
  // needs to reach the <img> for the "Copy image" menu). The raw text stays
  // reachable with the arrow keys.
  ignoreEvent(): boolean {
    return true
  }
}

class VideoWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly resolve: ImageResolver
  ) {
    super()
  }

  eq(other: VideoWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-video-widget'
    addMarkdownCaption(wrap, this.alt, this.src)
    const video = document.createElement('video')
    video.controls = true
    video.preload = 'metadata'
    video.onloadedmetadata = () => view.requestMeasure()
    if (/^(https?:|data:|blob:)/.test(this.src)) {
      video.src = this.src
    } else {
      void this.resolve(this.src).then((url) => {
        if (url) video.src = url
        else wrap.classList.add('cm-video-missing')
      })
    }
    wrap.appendChild(video)
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showMediaMenu(e.clientX, e.clientY, [
        { label: get(t)('video.download'), run: () => downloadFile(video.src, this.src) },
        { label: get(t)('media.delete'), run: () => deleteMediaAt(view, wrap) }
      ])
    })
    return wrap
  }

  // The player owns every event: a click on play/pause/scrubber must not
  // move the caret into the markdown, which would tear the widget down
  // mid-playback. The raw text stays reachable with the arrow keys.
  ignoreEvent(): boolean {
    return true
  }
}

// Monochrome SVG icons (no emoji): document sheet for PDF, grid for CSV.
const FILE_ICONS: Record<'pdf' | 'csv', string> = {
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h7"/></svg>',
  csv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M9.5 5v14M14.75 10v9"/></svg>'
}

class FileWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly kind: 'pdf' | 'csv',
    readonly resolve: ImageResolver
  ) {
    super()
  }

  eq(other: FileWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.kind === this.kind
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = `cm-file-widget cm-file-${this.kind}`
    // No markdown caption here: the card already shows the file name, and
    // hovering a full path over it is just noise (Baha's call).
    const icon = document.createElement('span')
    icon.className = 'cm-file-icon'
    icon.innerHTML = FILE_ICONS[this.kind]
    const name = document.createElement('span')
    name.className = 'cm-file-name'
    name.textContent = this.alt || decodeURI(this.src).split('/').pop() || this.src
    const ext = document.createElement('span')
    ext.className = 'cm-file-ext'
    ext.textContent = this.kind.toUpperCase()
    wrap.append(icon, name, ext)

    // The blob URL arrives async; actions before it resolves are no-ops.
    let url: string | null = null
    let fileData: File | null = null
    const fileName = decodeURI(this.src).split('/').pop() || `file.${this.kind}`
    void this.resolve(this.src).then(async (u) => {
      if (!u) {
        wrap.classList.add('cm-file-missing')
        return
      }
      url = u
      // Prefetched: dragstart is synchronous and needs the File ready.
      const blob = await (await fetch(u)).blob()
      fileData = new File([blob], fileName, { type: FILE_MIME[this.kind] })
    })

    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const items = [
        { label: get(t)('file.open'), run: () => url && void openFileInTab(url, this.kind) },
        { label: get(t)('file.copy'), run: () => url && void copyFileToClipboard(url, this.kind) },
        ...(this.kind === 'csv' ? [{ label: get(t)('csv.copy'), run: () => url && copyCsvText(url) }] : []),
        { label: get(t)('file.download'), run: () => url && downloadFile(url, this.src) },
        { label: get(t)('media.delete'), run: () => deleteMediaAt(view, wrap) }
      ]
      showMediaMenu(e.clientX, e.clientY, items)
    })
    // Double click = quick open, mirroring the images' quick copy.
    wrap.addEventListener('dblclick', (e) => {
      e.preventDefault()
      if (url) void openFileInTab(url, this.kind)
    })
    // The card drags straight out of the app: Finder/desktop receive the
    // real file via Chrome's DownloadURL, web targets (mail, chats) via the
    // attached File. The marker lets in-app drop handlers ignore the drag,
    // so it cannot duplicate the card. No preventDefault on mousedown here
    // (it would stop the browser from ever starting the drag); the caret
    // stays protected anyway — ignoreEvent() keeps CodeMirror out and
    // user-select: none keeps the native selection from anchoring inside.
    wrap.draggable = true
    wrap.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer || !url) return
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData(BRAIN_FILE_DRAG, this.src)
      e.dataTransfer.setData('DownloadURL', `${FILE_MIME[this.kind]}:${fileName}:${url}`)
      if (fileData) e.dataTransfer.items.add(fileData)
    })
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

/**
 * Render `![alt](src)` as the actual image — or a video player when src has
 * a video extension, or a file card for PDF/CSV. The raw markdown shows only while the selection is
 * strictly inside it (arrow keys / drag-select into it), NOT whenever the
 * caret is merely on the same line — otherwise a note whose only content is
 * an image could never show it.
 */
function imagePlugin(resolve: ImageResolver): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const sel = view.state.selection.ranges
    // A blurred editor is all rendered: its stale selection must not keep
    // raw markdown (or a selection highlight) on screen.
    const selectionInside = (from: number, to: number) =>
      view.hasFocus && sel.some((r) => r.from < to && r.to > from)
    for (const range of view.visibleRanges) {
      let pos = range.from
      while (pos <= range.to) {
        const line = view.state.doc.lineAt(pos)
        IMAGE_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = IMAGE_RE.exec(line.text))) {
          const from = line.from + m.index
          const to = from + m[0].length
          if (!selectionInside(from, to)) {
            const fileExt = FILE_SRC_RE.exec(m[2])
            const widget = VIDEO_SRC_RE.test(m[2])
              ? new VideoWidget(m[2], m[1], resolve)
              : fileExt
                ? new FileWidget(m[2], m[1], fileExt[1].toLowerCase() as 'pdf' | 'csv', resolve)
                : new ImageWidget(m[2], m[1], resolve)
            builder.add(from, to, Decoration.replace({ widget }))
          }
        }
        pos = line.to + 1
      }
    }
    return builder.finish()
  }

  return ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(this: { decorations: DecorationSet }, update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
          this.decorations = build(update.view)
        }
      }
    }),
    { decorations: (v) => v.decorations }
  )
}

// ---------- Wiki links ----------

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g

class WikiLinkWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly onNavigate: (name: string) => void
  ) {
    super()
  }

  eq(other: WikiLinkWidget): boolean {
    return other.name === this.name
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-wikilink'
    span.textContent = this.name
    // Same caret protection as the media widgets: the click must navigate,
    // not seat the native selection inside the widget DOM.
    span.addEventListener('mousedown', (e) => {
      if (e.button !== 2) e.preventDefault()
    })
    span.addEventListener('click', (e) => {
      e.preventDefault()
      this.onNavigate(this.name)
    })
    return span
  }

  ignoreEvent(): boolean {
    return true
  }
}

/** Render `[[note-name]]` as a clickable link to that note, wikipedia
 *  style. The raw brackets come back while the selection is inside the
 *  range (arrow keys in), so the link stays editable in place. */
function wikiLinkPlugin(onNavigate: (name: string) => void): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const sel = view.state.selection.ranges
    const selectionInside = (from: number, to: number) =>
      view.hasFocus && sel.some((r) => r.from < to && r.to > from)
    for (const range of view.visibleRanges) {
      let pos = range.from
      while (pos <= range.to) {
        const line = view.state.doc.lineAt(pos)
        WIKILINK_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = WIKILINK_RE.exec(line.text))) {
          const from = line.from + m.index
          const to = from + m[0].length
          if (!selectionInside(from, to)) {
            builder.add(from, to, Decoration.replace({ widget: new WikiLinkWidget(m[1], onNavigate) }))
          }
        }
        pos = line.to + 1
      }
    }
    return builder.finish()
  }

  return ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(this: { decorations: DecorationSet }, update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
          this.decorations = build(update.view)
        }
      }
    }),
    { decorations: (v) => v.decorations }
  )
}

// ---------- Heading spacing ----------

const HEADING_NODE = /^(ATXHeading[1-6]|SetextHeading[12])$/

/** Headings get breathing room above, so sections read as paragraphs. */
function headingSpacingPlugin(): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const seen = new Set<number>()
    for (const range of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from: range.from,
        to: range.to,
        enter(node) {
          if (!HEADING_NODE.test(node.name)) return
          const line = view.state.doc.lineAt(node.from)
          if (line.from === 0 || seen.has(line.from)) return
          seen.add(line.from)
          builder.add(line.from, line.from, Decoration.line({ class: 'cm-heading-line' }))
        }
      })
    }
    return builder.finish()
  }

  return ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(this: { decorations: DecorationSet }, update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = build(update.view)
        }
      }
    }),
    { decorations: (v) => v.decorations }
  )
}

// ---------- Horizontal rules ----------

class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-hr-widget'
    return span
  }

  // Let clicks through to CodeMirror: the caret lands on the rule's line,
  // which reveals the raw dashes for editing.
  ignoreEvent(): boolean {
    return false
  }
}

/** Render `---` (and `***` / `___`) on its own line as an actual separator
 *  line. The raw dashes come back while the selection touches that line, so
 *  the text stays editable in place — same deal as the media widgets. */
function hrPlugin(): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const sel = view.state.selection.ranges
    for (const range of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from: range.from,
        to: range.to,
        enter(node) {
          if (node.name !== 'HorizontalRule') return
          const line = view.state.doc.lineAt(node.from)
          if (view.hasFocus && sel.some((r) => r.from <= line.to && r.to >= line.from)) return
          builder.add(line.from, line.to, Decoration.replace({ widget: new HrWidget() }))
        }
      })
    }
    return builder.finish()
  }

  return ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(this: { decorations: DecorationSet }, update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
          this.decorations = build(update.view)
        }
      }
    }),
    { decorations: (v) => v.decorations }
  )
}

// ---------- Tables ----------

// Whether the editor has focus is view state, but a widget that swallows
// line breaks may only come from the state (plugins cannot change the
// document's block structure) — so focus is mirrored into the field.
const setTableFocus = StateEffect.define<boolean>()

/** Caret offset for a click on rendered markdown: the cell carries the raw
 *  offset of its content, the spans inside their offset within the cell. */
function rawOffsetAt(e: MouseEvent, cell: HTMLElement): number {
  const base = Number(cell.dataset.base)
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY)
  if (!range) return base
  const node = range.startContainer
  const el = node instanceof Element ? node : node.parentElement
  const r = el?.closest<HTMLElement>('[data-r]')?.dataset.r
  if (r == null || !cell.contains(el)) return base
  return base + Number(r) + range.startOffset
}

/** Replace the table's source with `text` (one undoable step). */
function replaceTable(view: EditorView, from: number, src: string, text: string): void {
  // The widget is rebuilt on every doc change, but a menu can outlive its
  // table (an edit from elsewhere): only write when the source still matches.
  if (view.state.doc.sliceString(from, from + src.length) !== src) return
  view.dispatch({ changes: { from, to: from + src.length, insert: text } })
}

/** Render a table (GFM pipe syntax) as a real table. */
class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly from: number,
    readonly table: ParsedTable
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other.src === this.src && other.from === this.from
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-widget'
    // Wide tables scroll inside their own box: the note column never does.
    const scroll = document.createElement('div')
    scroll.className = 'cm-table-scroll'
    const el = document.createElement('table')
    const { table } = this
    const lines = [table.header, ...table.body]

    lines.forEach((line, r) => {
      const tr = document.createElement('tr')
      for (let c = 0; c < table.cols; c++) {
        const cellNode = document.createElement(r === 0 ? 'th' : 'td')
        const cell = line.cells[c]
        const align = table.align[c]
        if (align) cellNode.style.textAlign = align
        // Missing trailing cells (a short row) still take a caret: their
        // click lands at the end of that row's line.
        cellNode.dataset.base = String(this.from + (cell ? cell.from : line.to))
        cellNode.dataset.row = String(r)
        cellNode.dataset.col = String(c)
        if (cell && cell.text !== '') cellNode.innerHTML = renderInlineMarkdown(cell.text)
        else cellNode.innerHTML = '<span data-r="0" class="cm-table-empty"></span>'
        tr.appendChild(cellNode)
      }
      ;(r === 0 ? el.createTHead() : (el.tBodies[0] ?? el.createTBody())).appendChild(tr)
    })

    // A click puts the caret in the raw markdown exactly where it landed:
    // the widget disappears and the pipes come back, ready to edit.
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-base]')
      if (!cell) return
      e.preventDefault()
      const pos = rawOffsetAt(e, cell)
      view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } })
      view.focus()
    })

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-base]')
      const row = cell ? Number(cell.dataset.row) : 0
      const col = cell ? Number(cell.dataset.col) : 0
      showMediaMenu(e.clientX, e.clientY, this.menuItems(view, row, col))
    })

    scroll.appendChild(el)
    wrap.appendChild(scroll)
    return wrap
  }

  /** Structural edits, applied by rewriting the whole (re-aligned) table. */
  private menuItems(view: EditorView, row: number, col: number) {
    const grid = toGrid(this.table)
    const align = this.table.align
    const write = (g: string[][], a: Align[] = align) =>
      replaceTable(view, this.from, this.src, serializeTable(g, a))
    const both = (r: [string[][], Align[]]) => write(r[0], r[1])
    const tr = (key: string) => get(t)(key)
    return [
      { label: tr('table.rowAbove'), run: () => write(insertRow(grid, row)) },
      { label: tr('table.rowBelow'), run: () => write(insertRow(grid, row + 1)) },
      { label: tr('table.delRow'), run: () => write(deleteRow(grid, row)) },
      { label: tr('table.colBefore'), run: () => both(insertColumn(grid, align, col)) },
      { label: tr('table.colAfter'), run: () => both(insertColumn(grid, align, col + 1)) },
      { label: tr('table.delCol'), run: () => both(deleteColumn(grid, align, col)) },
      { label: tr('table.alignLeft'), run: () => write(grid, setAlign(align, col, 'left')) },
      { label: tr('table.alignCenter'), run: () => write(grid, setAlign(align, col, 'center')) },
      { label: tr('table.alignRight'), run: () => write(grid, setAlign(align, col, 'right')) },
      { label: tr('table.tidy'), run: () => write(grid) },
      { label: tr('table.delete'), run: () => replaceTable(view, this.from, this.src, '') }
    ]
  }

  // The widget owns its events (click-to-caret and the menu are both
  // computed from the cell under the pointer, which CodeMirror cannot map
  // on its own — the rendered text has no position in the document).
  ignoreEvent(): boolean {
    return true
  }
}

/**
 * Publish the editor's width as `--cm-table-w` on the content element.
 * A table box must be given a width in pixels: left to the layout it would
 * take its content's width, stretching `.cm-content` (whose overflow is
 * hidden) and clipping the table AND the prose around it. The scroller's
 * width comes from the page, not from the content, so there is no loop.
 */
function tableWidthPlugin(): Extension {
  const publish = (view: EditorView) =>
    view.requestMeasure({
      read: (v) => v.scrollDOM.clientWidth,
      write: (width, v) => {
        // The content keeps 2px of right padding for the drawn caret.
        v.contentDOM.style.setProperty('--cm-table-w', Math.max(0, width - 2) + 'px')
      }
    })

  return ViewPlugin.define((view) => {
    publish(view)
    return {
      update(update: ViewUpdate) {
        if (update.geometryChanged) publish(update.view)
      }
    }
  })
}

/**
 * Replace every pipe table with a rendered one. Like the images and the
 * `---` rules, the raw markdown comes back while the selection is inside
 * it, so the table stays editable as plain text in place.
 */
function tableExtension(): Extension {
  const build = (state: EditorState, focused: boolean): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const sel = state.selection.ranges
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name !== 'Table') return
        const first = state.doc.lineAt(node.from)
        // The node may or may not include the newline closing the last row.
        const last = state.doc.lineAt(Math.max(node.from, node.to - 1))
        if (focused && sel.some((r) => r.from <= last.to && r.to >= first.from)) return
        const src = state.doc.sliceString(first.from, last.to)
        const table = parseTable(src)
        if (!table) return
        builder.add(
          first.from,
          last.to,
          Decoration.replace({ widget: new TableWidget(src, first.from, table), block: true })
        )
      }
    })
    return builder.finish()
  }

  const field = StateField.define<{ focused: boolean; deco: DecorationSet }>({
    create: (state) => ({ focused: false, deco: build(state, false) }),
    update(value, tr) {
      let focused = value.focused
      for (const e of tr.effects) if (e.is(setTableFocus)) focused = e.value
      if (!tr.docChanged && !tr.selection && focused === value.focused) return value
      return { focused, deco: build(tr.state, focused) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco)
  })

  return [field, EditorView.focusChangeEffect.of((_, focusing) => setTableFocus.of(focusing))]
}

/** Table markdown for pasted text: a ragged table gets its columns lined
 *  up, one squashed onto a single line gets its rows back. */
function tableFromPaste(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.includes('|')) return null
  return tidyTable(trimmed) ?? unflattenTable(trimmed)
}

/** Insert table markdown at the caret, on lines of its own, and leave the
 *  caret one blank line below (so the table shows up rendered, and whatever
 *  is typed next — another pasted table included — starts its own block).
 *  Returns the offset the table starts at. */
function insertTable(view: EditorView, text: string): number {
  const { from, to } = view.state.selection.main
  const doc = view.state.doc
  const before = doc.sliceString(doc.lineAt(from).from, from).trim() === '' ? '' : '\n\n'
  const rest = doc.sliceString(to, doc.lineAt(to).to).trim() !== ''
  const insert = before + text + '\n\n' + (rest ? '\n' : '')
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length + text.length + 2 },
    scrollIntoView: true
  })
  return from + before.length
}

/** New empty table from the insert menu: the first header cell is selected
 *  so naming the columns is just typing. */
function insertNewTable(view: EditorView): void {
  const first = 'Col 1'
  const at = insertTable(view, emptyTable())
  view.dispatch({ selection: { anchor: at + 2, head: at + 2 + first.length } })
  view.focus()
}

/** The inline formatting entries of the right-click menu (shared by the
 *  plain-text branch and the "convert to table" one). */
function formatMenuItems(view: EditorView): Array<{ label: string; run(): void }> {
  return FORMATS.map(([key, marker]) => ({
    label: get(t)(key),
    run: () => {
      toggleWrap(marker)(view)
      view.focus()
    }
  }))
}

// ---------- Hide markdown formatting ----------

// Marks hidden in "clean" mode. List bullets stay: they carry meaning.
const HIDDEN_MARKS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'QuoteMark'])

/**
 * Hide formatting characters (#, **, *, `, ~~, >) plus link syntax, keeping
 * the styled text. Marks reappear only while the selection is inside the
 * enclosing formatted span (the word in **bold**, the [link](url)), not
 * whenever the caret merely lands somewhere on the same line.
 */
function hideMarkupPlugin(): Extension {
  const build = (view: EditorView): DecorationSet => {
    const marks: Array<{ from: number; to: number }> = []
    const sel = view.state.selection.ranges
    const doc = view.state.doc
    for (const range of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from: range.from,
        to: range.to,
        enter(node) {
          let { from, to } = node
          const isLink = node.name === 'LinkMark' || node.name === 'URL'
          if (!HIDDEN_MARKS.has(node.name) && !isLink) return
          const parent = node.node.parent
          const spanFrom = parent ? parent.from : from
          const spanTo = parent ? parent.to : to
          if (view.hasFocus && sel.some((r) => r.from <= spanTo && r.to >= spanFrom)) return
          // "# Title" / "> quote": swallow the space after the mark too.
          if ((node.name === 'HeaderMark' || node.name === 'QuoteMark') && doc.sliceString(to, to + 1) === ' ') {
            to += 1
          }
          marks.push({ from, to })
        }
      })
    }
    marks.sort((a, b) => a.from - b.from || a.to - b.to)
    const builder = new RangeSetBuilder<Decoration>()
    let last = -1
    for (const m of marks) {
      if (m.from < last) continue
      builder.add(m.from, m.to, Decoration.replace({}))
      last = m.to
    }
    return builder.finish()
  }

  return ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(this: { decorations: DecorationSet }, update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
          this.decorations = build(update.view)
        }
      }
    }),
    { decorations: (v) => v.decorations }
  )
}

// Inline spans the format toggles recognize, keyed by their marker.
const MARKER_NODE: Record<string, string> = {
  '**': 'StrongEmphasis',
  '*': 'Emphasis',
  '`': 'InlineCode',
  '~~': 'Strikethrough'
}

/**
 * Wrap the selection in a marker pair — or, when the selection already sits
 * inside a span of that same format (per the syntax tree), remove that
 * span's markers instead. Repeated toggles alternate cleanly rather than
 * piling `****` up. Inside `inline code` the other formats are no-ops:
 * markdown cannot style text within code.
 */
function toggleWrap(marker: string) {
  return (view: EditorView): boolean => {
    const { from, to } = view.state.selection.main
    const target = MARKER_NODE[marker]
    for (
      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(from, from === to ? -1 : 1);
      node;
      node = node.parent
    ) {
      if (node.from > from || node.to < to) continue
      if (node.name === target) {
        // Unwrap: drop the opening and closing marks of the enclosing span.
        const open = node.firstChild
        const close = node.lastChild
        if (open && close && close.from > open.to) {
          view.dispatch({
            changes: [
              { from: open.from, to: open.to },
              { from: close.from, to: close.to }
            ]
          })
        }
        return true
      }
      if (node.name === 'InlineCode' && marker !== '`') return true
    }
    const selected = view.state.sliceDoc(from, to)
    const len = marker.length
    view.dispatch({
      changes: { from, to, insert: marker + selected + marker },
      selection: { anchor: from + len, head: to + len }
    })
    return true
  }
}

export interface NoteEditor {
  getOffset(): number
  focusEnd(): void
  focusAt(x: number, y: number): void
  setHideMarkup(hide: boolean): void
  /** Insert text as its own paragraph at the position nearest to (x, y). */
  insertBlockAt(x: number, y: number, text: string): void
  destroy(): void
}

export async function createNoteEditor(
  parent: HTMLElement,
  opts: {
    text: string
    hideMarkup: boolean
    resolveImage: ImageResolver
    /** Persist a pasted image and return the relative markdown src. */
    saveImage(file: File): Promise<string>
    onChange(text: string): void
    onFocus(): void
    /** Right-click on an empty line offers block inserts; the host splits the note. */
    onInsert(kind: 'todo' | 'sql' | 'code'): void
    /** Click on a [[wiki-link]]: open that note. */
    onNavigate(name: string): void
  }
): Promise<NoteEditor> {
  const { markdown, markdownKeymap } = await import('@codemirror/lang-markdown')
  const { Strikethrough, Table } = await import('@lezer/markdown')

  const markupCompartment = new Compartment()

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        history(),
        EditorView.lineWrapping,
        // Custom drawn caret/selection: reliably visible (and blinking)
        // even on empty documents, unlike the native caret.
        drawSelection({ cursorBlinkRate: 1000 }),
        keymap.of([
          { key: 'Mod-b', run: toggleWrap('**') },
          { key: 'Mod-i', run: toggleWrap('*') },
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        // Setext headings removed: a `-----` right under a paragraph would
        // silently promote it to a chapter title, but here dashes are used
        // as visual separators and headings are always written with `#`.
        // Strikethrough (GFM) is added on top of commonmark so the menu's
        // ~~strike~~ renders styled instead of as raw tildes.
        // Table (GFM) too: pipe tables render as real tables.
        markdown({ extensions: [Strikethrough, Table, { remove: ['SetextHeading'] }] }),
        syntaxHighlighting(markdownHighlight),
        headingSpacingPlugin(),
        hrPlugin(),
        tableExtension(),
        tableWidthPlugin(),
        wikiLinkPlugin(opts.onNavigate),
        imagePlugin(opts.resolveImage),
        // Pasting an image or video (screenshot, copied file) saves it next
        // to the document and inserts its markdown link at the caret.
        EditorView.domEventHandlers({
          paste: (event, v) => {
            const files = [...(event.clipboardData?.files ?? [])].filter(isMediaFile)
            if (files.length === 0) {
              // Copied tables arrive either ragged or (from anywhere that
              // keeps a single line) with their rows glued together; both
              // land as a properly formatted table.
              const table = tableFromPaste(event.clipboardData?.getData('text/plain') ?? '')
              if (!table) return false
              event.preventDefault()
              insertTable(v, table)
              return true
            }
            event.preventDefault()
            void (async () => {
              for (const file of files) {
                const rel = await opts.saveImage(file)
                const pos = v.state.selection.main.head
                const md = `![${file.name}](${rel})`
                v.dispatch({
                  changes: { from: pos, insert: md },
                  selection: { anchor: pos + md.length },
                  scrollIntoView: true
                })
              }
            })()
            return true
          },
          // Media drops belong to DocView (save to assets/ + insert the
          // card). Claiming the event here skips CodeMirror's own drop
          // handler, which reads text files (CSVs!) and would paste their
          // whole content into the note on top of the card.
          drop: (event) => {
            if (event.dataTransfer?.types.includes(BRAIN_FILE_DRAG)) {
              // One of our own cards dragged around: never re-import it.
              event.preventDefault()
              return true
            }
            return [...(event.dataTransfer?.files ?? [])].some(isMediaFile)
          },
          // Right-click is the block/formatting menu: on an empty line it
          // offers the inserts (todo/SQL/code — this replaced the floating
          // "+"), on text the markdown formattings. Media widgets are left
          // alone: they bring up their own menu (copy, download, remove).
          contextmenu: (event, v) => {
            const target = event.target as HTMLElement
            if (target.closest('.cm-image-widget, .cm-video-widget, .cm-file-widget, .cm-table-widget')) {
              return false
            }
            const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }, false)
            event.preventDefault()
            const sel = v.state.selection.main
            // Clicking inside the selection keeps it (format it); anywhere
            // else the caret moves there, grabbing the word under the click.
            if (sel.empty || pos < sel.from || pos > sel.to) {
              const word = v.state.wordAt(pos)
              v.dispatch({ selection: word ? { anchor: word.from, head: word.to } : { anchor: pos } })
            }
            v.focus()
            const cur = v.state.selection.main
            const emptyLine = cur.empty && v.state.doc.lineAt(pos).text.trim() === ''
            // A line that is a whole table squashed into one (pasted
            // from a chat, a todo item…) offers to become a real table.
            const flat = emptyLine ? null : unflattenTable(v.state.doc.lineAt(pos).text)
            const items = emptyLine
              ? [
                  { label: get(t)('insert.todo'), run: () => opts.onInsert('todo') },
                  { label: get(t)('insert.table'), run: () => insertNewTable(v) },
                  { label: 'SQL', run: () => opts.onInsert('sql') },
                  { label: get(t)('insert.code'), run: () => opts.onInsert('code') }
                ]
              : flat
                ? [
                    {
                      label: get(t)('table.convert'),
                      run: () => {
                        const line = v.state.doc.lineAt(pos)
                        v.dispatch({ changes: { from: line.from, to: line.to, insert: flat } })
                      }
                    },
                    ...formatMenuItems(v)
                  ]
                : formatMenuItems(v)
            showMediaMenu(event.clientX, event.clientY, items)
            return true
          }
        }),
        markupCompartment.of(opts.hideMarkup ? hideMarkupPlugin() : []),
        noteTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) opts.onChange(update.state.doc.toString())
          if (update.focusChanged && update.view.hasFocus) opts.onFocus()
        })
      ]
    })
  })

  function placeCaret(pos: number) {
    view.focus()
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    // Focus can be lost to whatever element the triggering click landed
    // on; verify on the next frame and retake it if needed.
    requestAnimationFrame(() => {
      if (!view.hasFocus) {
        view.focus()
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      }
    })
  }

  return {
    getOffset() {
      return view.state.selection.main.head
    },
    focusEnd() {
      placeCaret(view.state.doc.length)
    },
    // Place the caret at the position nearest to a click anywhere on the
    // page, so the whole surface feels writable.
    focusAt(x: number, y: number) {
      const pos = view.posAtCoords({ x, y }, false)
      const end = view.state.doc.length
      if (pos == null) {
        placeCaret(end)
        return
      }
      // Zen-style vertical freedom: a click below the last line grows the
      // document with blank lines down to the clicked height, instead of
      // snapping the caret back up to the end of the text.
      if (pos === end) {
        const endCoords = view.coordsAtPos(end)
        if (endCoords && y > endCoords.bottom) {
          const lines = Math.round((y - endCoords.bottom) / view.defaultLineHeight)
          if (lines > 0) {
            view.dispatch({ changes: { from: end, insert: '\n'.repeat(lines) } })
            placeCaret(view.state.doc.length)
            return
          }
        }
      }
      placeCaret(pos)
    },
    setHideMarkup(hide: boolean) {
      view.dispatch({ effects: markupCompartment.reconfigure(hide ? hideMarkupPlugin() : []) })
    },
    insertBlockAt(x: number, y: number, text: string) {
      const pos = view.posAtCoords({ x, y }, false) ?? view.state.doc.length
      const line = view.state.doc.lineAt(pos)
      // Drop onto a non-empty line: land below it, on its own paragraph.
      const from = line.text.trim() === '' ? line.from : line.to
      const insert = line.text.trim() === '' ? text : '\n\n' + text
      view.dispatch({
        changes: { from, to: from === line.from ? line.to : from, insert },
        selection: { anchor: from + insert.length },
        scrollIntoView: true
      })
      view.focus()
    },
    destroy() {
      view.destroy()
    }
  }
}

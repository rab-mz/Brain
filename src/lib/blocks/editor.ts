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
import { EditorState, Compartment, RangeSetBuilder, type Extension } from '@codemirror/state'
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
import { get } from 'svelte/store'
import { showToast } from '../stores'
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
    caretColor: 'var(--fg)'
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

// Video files reuse the ![alt](src) image syntax — the extension decides
// which widget renders, so the markdown stays readable outside the app.
const VIDEO_SRC_RE = /\.(mp4|mov|m4v|webm)$/i

/** Media (image or video) accepted by paste/drop. Some .mov drags arrive
 *  with an empty MIME type, so the filename extension is the fallback. */
export function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/') || VIDEO_SRC_RE.test(file.name)
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

function showMediaMenu(x: number, y: number, items: Array<{ label: string; run(): void }>): void {
  const menu = document.createElement('div')
  menu.className = 'cm-image-menu'
  for (const it of items) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = it.label
    btn.onclick = () => {
      close()
      it.run()
    }
    menu.appendChild(btn)
  }
  const close = () => {
    menu.remove()
    window.removeEventListener('pointerdown', onAway, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', close)
  }
  const onAway = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  document.body.appendChild(menu)
  const r = menu.getBoundingClientRect()
  menu.style.left = Math.max(0, Math.min(x, window.innerWidth - r.width - 8)) + 'px'
  menu.style.top = Math.max(0, Math.min(y, window.innerHeight - r.height - 8)) + 'px'
  window.addEventListener('pointerdown', onAway, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', close)
}

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

/** Save a copy of the video through a download link (the clipboard cannot
 *  hold video files, so "copy" for videos means "download a copy"). */
function downloadVideo(src: string, markdownSrc: string): void {
  const a = document.createElement('a')
  a.href = src
  a.download = decodeURI(markdownSrc).split('/').pop() || 'video'
  a.click()
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
        { label: get(t)('video.download'), run: () => downloadVideo(video.src, this.src) },
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

/**
 * Render `![alt](src)` as the actual image — or a video player when src has
 * a video extension. The raw markdown shows only while the selection is
 * strictly inside it (arrow keys / drag-select into it), NOT whenever the
 * caret is merely on the same line — otherwise a note whose only content is
 * an image could never show it.
 */
function imagePlugin(resolve: ImageResolver): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const sel = view.state.selection.ranges
    const selectionInside = (from: number, to: number) => sel.some((r) => r.from < to && r.to > from)
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
            const widget = VIDEO_SRC_RE.test(m[2])
              ? new VideoWidget(m[2], m[1], resolve)
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
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
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
          if (sel.some((r) => r.from <= spanTo && r.to >= spanFrom)) return
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
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = build(update.view)
        }
      }
    }),
    { decorations: (v) => v.decorations }
  )
}

/** Wrap the selection in a marker pair, or unwrap if already wrapped. */
function toggleWrap(marker: string) {
  return (view: EditorView): boolean => {
    const { from, to } = view.state.selection.main
    const selected = view.state.sliceDoc(from, to)
    const len = marker.length
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= 2 * len) {
      view.dispatch({
        changes: { from, to, insert: selected.slice(len, selected.length - len) },
        selection: { anchor: from, head: to - 2 * len }
      })
    } else {
      view.dispatch({
        changes: { from, to, insert: marker + selected + marker },
        selection: { anchor: from + len, head: to + len }
      })
    }
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
  }
): Promise<NoteEditor> {
  const { markdown, markdownKeymap } = await import('@codemirror/lang-markdown')

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
        markdown(),
        syntaxHighlighting(markdownHighlight),
        headingSpacingPlugin(),
        imagePlugin(opts.resolveImage),
        // Pasting an image or video (screenshot, copied file) saves it next
        // to the document and inserts its markdown link at the caret.
        EditorView.domEventHandlers({
          paste: (event, v) => {
            const files = [...(event.clipboardData?.files ?? [])].filter(isMediaFile)
            if (files.length === 0) return false
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
      placeCaret(pos ?? view.state.doc.length)
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

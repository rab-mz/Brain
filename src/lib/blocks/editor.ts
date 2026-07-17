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
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: MONO, fontSize: '0.9em' },
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
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--muted)' }
})

// ---------- Inline images ----------

/** Resolves an image src (usually a path relative to the document) to a URL. */
export type ImageResolver = (src: string) => Promise<string | null>

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

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
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

/** Lines the selection touches show raw markdown so they stay editable. */
function selectionLines(view: EditorView): Array<{ from: number; to: number }> {
  return view.state.selection.ranges.map((r) => ({
    from: view.state.doc.lineAt(r.from).from,
    to: view.state.doc.lineAt(r.to).to
  }))
}

function touchesSelection(lines: Array<{ from: number; to: number }>, from: number, to: number): boolean {
  return lines.some((l) => from <= l.to && to >= l.from)
}

/** Render `![alt](src)` as the actual image, except on the line being edited. */
function imagePlugin(resolve: ImageResolver): Extension {
  const build = (view: EditorView): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>()
    const active = selectionLines(view)
    for (const range of view.visibleRanges) {
      let pos = range.from
      while (pos <= range.to) {
        const line = view.state.doc.lineAt(pos)
        if (!touchesSelection(active, line.from, line.to)) {
          IMAGE_RE.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = IMAGE_RE.exec(line.text))) {
            builder.add(
              line.from + m.index,
              line.from + m.index + m[0].length,
              Decoration.replace({ widget: new ImageWidget(m[2], m[1], resolve) })
            )
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

// ---------- Hide markdown formatting ----------

// Marks hidden in "clean" mode. List bullets stay: they carry meaning.
const HIDDEN_MARKS = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark', 'QuoteMark'])

/**
 * Hide formatting characters (#, **, *, `, ~~, >) plus link syntax, keeping
 * the styled text. The line under the caret shows the raw markdown.
 */
function hideMarkupPlugin(): Extension {
  const build = (view: EditorView): DecorationSet => {
    const marks: Array<{ from: number; to: number }> = []
    const active = selectionLines(view)
    const doc = view.state.doc
    for (const range of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from: range.from,
        to: range.to,
        enter(node) {
          let { from, to } = node
          const isLink = node.name === 'LinkMark' || node.name === 'URL'
          if (!HIDDEN_MARKS.has(node.name) && !isLink) return
          if (touchesSelection(active, from, to)) return
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
        imagePlugin(opts.resolveImage),
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

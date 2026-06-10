// CodeMirror 6 setup. This module is ONLY ever loaded via dynamic import
// from CodeBlock.svelte / NoteBlock.svelte, so none of it lands in the
// initial bundle.

import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle
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
  '.cm-content': {
    fontFamily: 'var(--doc-font)',
    lineHeight: '1.65',
    padding: '2px 0',
    caretColor: 'var(--fg)'
  },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--muted)' }
})

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
  destroy(): void
}

export async function createNoteEditor(
  parent: HTMLElement,
  opts: {
    text: string
    placeholder: string
    onChange(text: string): void
    onFocus(): void
  }
): Promise<NoteEditor> {
  const { markdown, markdownKeymap } = await import('@codemirror/lang-markdown')

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        history(),
        EditorView.lineWrapping,
        keymap.of([
          { key: 'Mod-b', run: toggleWrap('**') },
          { key: 'Mod-i', run: toggleWrap('*') },
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap
        ]),
        markdown(),
        syntaxHighlighting(markdownHighlight),
        noteTheme,
        placeholder(opts.placeholder),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) opts.onChange(update.state.doc.toString())
          if (update.focusChanged && update.view.hasFocus) opts.onFocus()
        })
      ]
    })
  })

  return {
    getOffset() {
      return view.state.selection.main.head
    },
    focusEnd() {
      view.focus()
      view.dispatch({ selection: { anchor: view.state.doc.length } })
    },
    // Place the caret at the position nearest to a click anywhere on the
    // page, so the whole surface feels writable.
    focusAt(x: number, y: number) {
      const pos = view.posAtCoords({ x, y }, false)
      view.focus()
      view.dispatch({ selection: { anchor: pos ?? view.state.doc.length } })
    },
    destroy() {
      view.destroy()
    }
  }
}

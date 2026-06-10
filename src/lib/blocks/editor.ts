// CodeMirror 6 setup. This module is ONLY ever loaded via dynamic import
// from CodeBlock.svelte, so none of it lands in the initial bundle.

import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'

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

import { writable } from 'svelte/store'
import type { BrainIndex } from './palette/snippets'
import type { NoteTree } from './fs/files'

export type AppState = 'loading' | 'unsupported' | 'welcome' | 'reconnect' | 'ready'

export const appState = writable<AppState>('loading')

export type ThemeName = 'dark' | 'light' | 'sepia' | 'ocean'
export const THEMES: ThemeName[] = ['dark', 'light', 'sepia', 'ocean']

/** Themes whose code blocks should use the dark CodeMirror theme. */
export function isDarkTheme(t: ThemeName): boolean {
  return t === 'dark' || t === 'ocean'
}

function initialTheme(): ThemeName {
  try {
    const t = localStorage.getItem('brain:theme')
    if ((THEMES as string[]).includes(t ?? '')) return t as ThemeName
  } catch {
    // localStorage unavailable: fall through to default.
  }
  return 'dark'
}

export const theme = writable<ThemeName>(initialTheme())
theme.subscribe((t) => {
  try {
    localStorage.setItem('brain:theme', t)
  } catch {
    // Ignore: theme just won't persist.
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
})

export type FontName = 'sans' | 'serif' | 'mono'
export const FONTS: FontName[] = ['sans', 'serif', 'mono']

function initialFont(): FontName {
  try {
    const f = localStorage.getItem('brain:font')
    if ((FONTS as string[]).includes(f ?? '')) return f as FontName
  } catch {
    // Fall through.
  }
  return 'sans'
}

export const font = writable<FontName>(initialFont())
font.subscribe((f) => {
  try {
    localStorage.setItem('brain:font', f)
  } catch {
    // Ignore.
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.font = f
})

export const sidebarCollapsed = writable(false)

/** notes/ listing with one level of user folders, in the user's manual order. */
export const noteTree = writable<NoteTree>({ files: [], folders: [] })
/** File names (not paths) inside journal/. */
export const journalFiles = writable<string[]>([])

/** Hide markdown formatting characters (#, **, *…) while reading. */
function initialHideMarkup(): boolean {
  try {
    return localStorage.getItem('brain:hide-markup') === '1'
  } catch {
    return false
  }
}
export const hideMarkup = writable<boolean>(initialHideMarkup())
hideMarkup.subscribe((v) => {
  try {
    localStorage.setItem('brain:hide-markup', v ? '1' : '0')
  } catch {
    // Ignore: preference just won't persist.
  }
})

/** path -> title from frontmatter, filled in by the background index. */
export const fileTitles = writable<Record<string, string>>({})

/** 'notes/x.md' | 'journal/YYYY-MM-DD.md' | 'ideas' | 'folder' | null while booting. */
export const currentPath = writable<string | null>(null)

export const paletteOpen = writable(false)

export const brainIndex = writable<BrainIndex | null>(null)

export const toast = writable<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function showToast(message: string): void {
  toast.set(message)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.set(null), 1600)
}

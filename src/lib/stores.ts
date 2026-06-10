import { writable } from 'svelte/store'
import type { BrainIndex } from './palette/snippets'

export type AppState = 'loading' | 'unsupported' | 'welcome' | 'reconnect' | 'ready'

export const appState = writable<AppState>('loading')

function initialTheme(): 'dark' | 'light' {
  try {
    const t = localStorage.getItem('brain:theme')
    if (t === 'light' || t === 'dark') return t
  } catch {
    // localStorage unavailable: fall through to default.
  }
  return 'dark'
}

export const theme = writable<'dark' | 'light'>(initialTheme())
theme.subscribe((t) => {
  try {
    localStorage.setItem('brain:theme', t)
  } catch {
    // Ignore: theme just won't persist.
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = t
})

export const sidebarCollapsed = writable(false)

/** File names (not paths) inside notes/ and journal/. */
export const noteFiles = writable<string[]>([])
export const journalFiles = writable<string[]>([])

/** path -> title from frontmatter, filled in by the background index. */
export const fileTitles = writable<Record<string, string>>({})

/** 'notes/x.md' | 'journal/YYYY-MM-DD.md' | 'ideas' | null while booting. */
export const currentPath = writable<string | null>(null)

export const paletteOpen = writable(false)
export const newNoteOpen = writable(false)

export const brainIndex = writable<BrainIndex | null>(null)

export const toast = writable<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function showToast(message: string): void {
  toast.set(message)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.set(null), 1600)
}

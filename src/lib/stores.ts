import { writable } from 'svelte/store'
import type { BrainIndex } from './palette/snippets'
import { emptyTree, type NoteTree } from './fs/files'

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

/** Width of the document column. Wide tables and code-heavy notes want more
 *  room than the comfortable reading measure, so it is a per-user setting. */
export type DocWidth = 'normal' | 'wide' | 'full'
export const DOC_WIDTHS: DocWidth[] = ['normal', 'wide', 'full']

function initialDocWidth(): DocWidth {
  try {
    const w = localStorage.getItem('brain:doc-width')
    if ((DOC_WIDTHS as string[]).includes(w ?? '')) return w as DocWidth
  } catch {
    // Fall through.
  }
  return 'normal'
}

export const docWidth = writable<DocWidth>(initialDocWidth())
docWidth.subscribe((w) => {
  try {
    localStorage.setItem('brain:doc-width', w)
  } catch {
    // Ignore: width just won't persist.
  }
  if (typeof document !== 'undefined') document.documentElement.dataset.width = w
})

export const sidebarCollapsed = writable(false)

// Which sidebar groups are expanded ('folder:<path under notes/>' such as
// 'folder:Spicchio POS/commerciale', 'year:2026', 'month:2026-09'). Folders
// follow one rule: a single chain is open at a time (a folder and the ones
// containing it), so "the open folder" is always unambiguous and the "+"
// buttons create inside it. A store (not Sidebar state) because "new note"
// and Alt+N also read it.
const SIDE_OPEN_KEY = 'brain:side-open'

const FOLDER_PREFIX = 'folder:'

/** Keep the deepest open folder of the stored set and its ancestors only
 *  (older versions allowed several folders open side by side). */
function oneFolderChain(keys: string[]): string[] {
  const folders = keys.filter((k) => k.startsWith(FOLDER_PREFIX)).map((k) => k.slice(FOLDER_PREFIX.length))
  const others = keys.filter((k) => !k.startsWith(FOLDER_PREFIX))
  if (folders.length === 0) return others
  const deepest = folders.reduce((a, b) => (b.split('/').length > a.split('/').length ? b : a))
  return [...others, ...folderChain(deepest)]
}

/** 'A/B/C' -> ['folder:A', 'folder:A/B', 'folder:A/B/C']. */
function folderChain(rel: string): string[] {
  const parts = rel.split('/')
  return parts.map((_, i) => FOLDER_PREFIX + parts.slice(0, i + 1).join('/'))
}

function initialSideOpen(): string[] {
  const d = new Date()
  // The current month is always worth a look.
  const monthKey = `month:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  try {
    const parsed = JSON.parse(localStorage.getItem(SIDE_OPEN_KEY) ?? '[]') as unknown
    const keys = oneFolderChain(Array.isArray(parsed) ? (parsed as string[]) : [])
    return keys.includes(monthKey) ? keys : [...keys, monthKey]
  } catch {
    return [monthKey]
  }
}

export const sideOpen = writable<string[]>(initialSideOpen())
sideOpen.subscribe((keys) => {
  try {
    localStorage.setItem(SIDE_OPEN_KEY, JSON.stringify(keys))
  } catch {
    // Ignore: state just won't persist.
  }
})

/** Open folder `rel` (path under notes/): every other folder closes except
 *  the ones containing it. Closing it closes its subfolders too. */
export function toggleFolder(rel: string): void {
  sideOpen.update((keys) => {
    const others = keys.filter((k) => !k.startsWith(FOLDER_PREFIX))
    if (keys.includes(FOLDER_PREFIX + rel)) {
      const parent = rel.split('/').slice(0, -1).join('/')
      return parent ? [...others, ...folderChain(parent)] : others
    }
    return [...others, ...folderChain(rel)]
  })
}

/** Open exactly this folder chain (after creating or moving a folder). */
export function openFolder(rel: string): void {
  sideOpen.update((keys) => [...keys.filter((k) => !k.startsWith(FOLDER_PREFIX)), ...folderChain(rel)])
}

/** The deepest open folder as a vault path ('notes/Spicchio POS/prodotto'),
 *  or 'notes' when every folder is closed. */
export function openFolderDir(open: string[]): string {
  const rels = open.filter((k) => k.startsWith(FOLDER_PREFIX)).map((k) => k.slice(FOLDER_PREFIX.length))
  if (rels.length === 0) return 'notes'
  return 'notes/' + rels.reduce((a, b) => (b.split('/').length > a.split('/').length ? b : a))
}

/** Where a new note or folder goes: inside the open folder. An assets/
 *  folder only holds files, so its first non-assets ancestor takes the note. */
export function newNoteDir(open: string[]): string {
  const parts = openFolderDir(open).split('/')
  const at = parts.indexOf('assets')
  return (at > 0 ? parts.slice(0, at) : parts).join('/')
}

/** notes/ as a tree (any depth, files and media), in the user's manual order. */
export const noteTree = writable<NoteTree>(emptyTree())
/** File names (not paths) inside journal/. */
export const journalFiles = writable<string[]>([])

/** Hide markdown formatting characters (#, **, *…) while reading.
 *  ON by default (formatting shows styled, markers only where the caret
 *  is) — new key so everyone starts clean; the '#' button still toggles. */
function initialHideMarkup(): boolean {
  try {
    const v = localStorage.getItem('brain:hide-markup2')
    if (v != null) return v === '1'
  } catch {
    // localStorage unavailable: fall through.
  }
  return true
}
export const hideMarkup = writable<boolean>(initialHideMarkup())
hideMarkup.subscribe((v) => {
  try {
    localStorage.setItem('brain:hide-markup2', v ? '1' : '0')
  } catch {
    // Ignore: preference just won't persist.
  }
})

/** path -> title from frontmatter, filled in by the background index. */
export const fileTitles = writable<Record<string, string>>({})

/** 'notes/x.md' | 'journal/YYYY-MM-DD.md' | 'ideas' | 'folder' | a non-note
 *  file under notes/ ('notes/X/assets/a.png', shown by MediaView) | null while booting. */
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

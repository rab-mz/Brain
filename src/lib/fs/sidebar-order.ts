// Manual sidebar preferences, persisted next to the notes in
// .brain/sidebar.json: the user's ordering plus per-folder colors.
// Order keys are directory paths ('notes', 'notes/entaksi'), values are
// file names in the order the user arranged them. Files not listed sort
// alphabetically after the ordered ones, so external edits never break
// the sidebar. Color keys are folder names, values are CSS colors.

import { readFile, writeFile } from './files'

export type SidebarOrder = Record<string, string[]>
export type FolderColors = Record<string, string>

export interface SidebarPrefs {
  order: SidebarOrder
  colors: FolderColors
}

const ORDER_PATH = '.brain/sidebar.json'

export async function loadSidebarPrefs(root: FileSystemDirectoryHandle): Promise<SidebarPrefs> {
  const text = await readFile(root, ORDER_PATH)
  if (text) {
    try {
      const parsed = JSON.parse(text) as { order?: SidebarOrder; colors?: FolderColors }
      return {
        order: parsed && typeof parsed.order === 'object' && parsed.order != null ? parsed.order : {},
        colors: parsed && typeof parsed.colors === 'object' && parsed.colors != null ? parsed.colors : {}
      }
    } catch {
      // Corrupt file: fall back to defaults.
    }
  }
  return { order: {}, colors: {} }
}

export async function saveSidebarPrefs(root: FileSystemDirectoryHandle, prefs: SidebarPrefs): Promise<void> {
  await writeFile(root, ORDER_PATH, JSON.stringify({ version: 1, order: prefs.order, colors: prefs.colors }, null, 2))
}

/** Apply a saved order to a live listing: ordered names first, the rest alphabetical. */
export function applyOrder(files: string[], order: string[] | undefined): string[] {
  if (!order || order.length === 0) return [...files].sort()
  const known = order.filter((name) => files.includes(name))
  const rest = files.filter((name) => !order.includes(name)).sort()
  return [...known, ...rest]
}

/** Deterministic color from the folder name: every folder is born with its
 *  own hue, no setup needed; a manual pick (saved in `colors`) overrides.
 *  The golden angle decorrelates similar names, so "Progetti" and
 *  "Progetti vecchi" still land far apart on the wheel. */
export function autoFolderColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${Math.round((h % 997) * 137.508) % 360} 62% 56%)`
}

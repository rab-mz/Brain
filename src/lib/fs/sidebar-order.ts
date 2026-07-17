// Manual sidebar ordering, persisted next to the notes in .brain/sidebar.json.
// Keys are directory paths ('notes', 'notes/entaksi'), values are file names
// in the order the user arranged them. Files not listed sort alphabetically
// after the ordered ones, so external edits never break the sidebar.

import { readFile, writeFile } from './files'

export type SidebarOrder = Record<string, string[]>

const ORDER_PATH = '.brain/sidebar.json'

export async function loadSidebarOrder(root: FileSystemDirectoryHandle): Promise<SidebarOrder> {
  const text = await readFile(root, ORDER_PATH)
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as { version?: number; order?: SidebarOrder }
    if (parsed && typeof parsed.order === 'object' && parsed.order != null) return parsed.order
  } catch {
    // Corrupt file: fall back to alphabetical order.
  }
  return {}
}

export async function saveSidebarOrder(root: FileSystemDirectoryHandle, order: SidebarOrder): Promise<void> {
  await writeFile(root, ORDER_PATH, JSON.stringify({ version: 1, order }, null, 2))
}

/** Apply a saved order to a live listing: ordered names first, the rest alphabetical. */
export function applyOrder(files: string[], order: string[] | undefined): string[] {
  if (!order || order.length === 0) return [...files].sort()
  const known = order.filter((name) => files.includes(name))
  const rest = files.filter((name) => !order.includes(name)).sort()
  return [...known, ...rest]
}

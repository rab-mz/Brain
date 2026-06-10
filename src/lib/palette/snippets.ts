// Search index cached in .brain/index.json: pinned snippets + file titles.
// Loaded instantly on startup, rebuilt lazily in the background.

import { parseDocument, type BrainDoc } from '../parser/parser'
import { listMarkdown, readFile, writeFile } from '../fs/files'

export interface Snippet {
  file: string
  title: string
  label: string
  language: string
  code: string
  blockIndex: number
}

export interface BrainIndex {
  version: 1
  builtAt: string
  titles: Record<string, string>
  snippets: Snippet[]
}

const INDEX_PATH = '.brain/index.json'

export function emptyIndex(): BrainIndex {
  return { version: 1, builtAt: new Date().toISOString(), titles: {}, snippets: [] }
}

export async function loadCachedIndex(root: FileSystemDirectoryHandle): Promise<BrainIndex | null> {
  const text = await readFile(root, INDEX_PATH)
  if (!text) return null
  try {
    const idx = JSON.parse(text) as BrainIndex
    if (idx && idx.version === 1 && Array.isArray(idx.snippets)) return idx
  } catch {
    // Corrupt cache: the background rebuild will replace it.
  }
  return null
}

export async function saveIndex(root: FileSystemDirectoryHandle, index: BrainIndex): Promise<void> {
  await writeFile(root, INDEX_PATH, JSON.stringify(index))
}

/** Replace one file's entries (titles + pinned snippets) in the index. */
export function indexFile(index: BrainIndex, path: string, doc: BrainDoc): void {
  const fallback = path.split('/').pop()!.replace(/\.md$/, '')
  index.titles[path] = doc.frontmatter.title || fallback
  index.snippets = index.snippets.filter((s) => s.file !== path)
  doc.blocks.forEach((block, i) => {
    if (block.type === 'code' && block.pinned) {
      index.snippets.push({
        file: path,
        title: index.titles[path],
        label: block.label,
        language: block.language,
        code: block.code,
        blockIndex: i
      })
    }
  })
}

/** Full rebuild: reads every note and journal file. Background use only. */
export async function buildIndex(root: FileSystemDirectoryHandle): Promise<BrainIndex> {
  const index = emptyIndex()
  for (const folder of ['notes', 'journal'] as const) {
    for (const name of await listMarkdown(root, folder)) {
      const path = `${folder}/${name}`
      const content = await readFile(root, path)
      if (content == null) continue
      indexFile(index, path, parseDocument(content))
    }
  }
  await saveIndex(root, index)
  return index
}

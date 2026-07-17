// Path-based file helpers on top of the File System Access API.
// Paths are always relative to the root folder, e.g. "notes/foo.md".

export const FOLDERS = ['notes', 'journal', 'ideas', '.brain'] as const

export async function ensureStructure(root: FileSystemDirectoryHandle): Promise<void> {
  for (const name of FOLDERS) {
    await root.getDirectoryHandle(name, { create: true })
  }
}

async function resolveDir(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/')
  let dir = root
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return { dir, name: parts[parts.length - 1] }
}

/** Returns null when the file does not exist or cannot be read. */
export async function readFile(root: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  try {
    const { dir, name } = await resolveDir(root, path)
    const handle = await dir.getFileHandle(name)
    const file = await handle.getFile()
    return await file.text()
  } catch {
    return null
  }
}

export async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  content: string | Blob | ArrayBuffer
): Promise<void> {
  const { dir, name } = await resolveDir(root, path, true)
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/** Returns null when the file does not exist or cannot be read. */
export async function readFileBlob(root: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  try {
    const { dir, name } = await resolveDir(root, path)
    const handle = await dir.getFileHandle(name)
    return await handle.getFile()
  } catch {
    return null
  }
}

/** Move a file (any type) to a new path. No-op when source and target match. */
export async function moveFile(root: FileSystemDirectoryHandle, from: string, to: string): Promise<void> {
  if (from === to) return
  const blob = await readFileBlob(root, from)
  if (!blob) return
  await writeFile(root, to, blob)
  await deleteFile(root, from)
}

/** Collapse '.', '..' and empty segments: "notes/a/../b" -> "notes/b". */
export function normalizePath(p: string): string {
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

const MD_IMAGE_LINK_RE = /(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g

/**
 * Move a markdown note to another directory, carrying its local images
 * along so relative links keep working. Returns the final content written.
 */
export async function moveNoteWithAssets(
  root: FileSystemDirectoryHandle,
  from: string,
  to: string
): Promise<void> {
  if (from === to) return
  const content = await readFile(root, from)
  if (content == null) return
  const fromDir = from.split('/').slice(0, -1).join('/')
  const toDir = to.split('/').slice(0, -1).join('/')
  let out = content
  if (fromDir !== toDir) {
    for (const m of content.matchAll(MD_IMAGE_LINK_RE)) {
      const src = m[2]
      if (/^(https?:|data:|blob:)/.test(src) || src.startsWith('/')) continue
      const rel = decodeURI(src)
      const oldAsset = normalizePath(`${fromDir}/${rel}`)
      if (!(await fileExists(root, oldAsset))) continue
      // Same relative name in the target; suffix on collision.
      let newRel = rel
      let n = 2
      while (await fileExists(root, normalizePath(`${toDir}/${newRel}`))) {
        const dot = rel.lastIndexOf('.')
        newRel = dot > 0 ? `${rel.slice(0, dot)}-${n++}${rel.slice(dot)}` : `${rel}-${n++}`
      }
      await moveFile(root, oldAsset, normalizePath(`${toDir}/${newRel}`))
      if (newRel !== rel) out = out.split(`(${src})`).join(`(${newRel})`)
    }
  }
  await writeFile(root, to, out)
  await deleteFile(root, from)
}

export async function deleteFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const { dir, name } = await resolveDir(root, path)
  await dir.removeEntry(name)
}

export async function fileExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    const { dir, name } = await resolveDir(root, path)
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/** List .md file names in a top-level folder. Names only — no content reads. */
export async function listMarkdown(root: FileSystemDirectoryHandle, folder: string): Promise<string[]> {
  const names: string[] = []
  try {
    const dir = await root.getDirectoryHandle(folder)
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) names.push(entry.name)
    }
  } catch {
    // Folder missing: treat as empty.
  }
  return names
}

/** Subfolder reserved for images dropped into documents — never a note folder. */
export const ASSETS_DIR = 'assets'

export interface NoteTree {
  /** .md files directly inside notes/. */
  files: string[]
  /** One level of user folders inside notes/, each with its .md files. */
  folders: Array<{ name: string; files: string[] }>
}

/** List notes/ including one level of user subfolders (assets/ excluded). */
export async function listNotesTree(root: FileSystemDirectoryHandle): Promise<NoteTree> {
  const tree: NoteTree = { files: [], folders: [] }
  try {
    const dir = await root.getDirectoryHandle('notes')
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        tree.files.push(entry.name)
      } else if (entry.kind === 'directory' && entry.name !== ASSETS_DIR) {
        const files: string[] = []
        for await (const sub of (entry as FileSystemDirectoryHandle).values()) {
          if (sub.kind === 'file' && sub.name.endsWith('.md')) files.push(sub.name)
        }
        tree.folders.push({ name: entry.name, files })
      }
    }
  } catch {
    // Folder missing: treat as empty.
  }
  tree.folders.sort((a, b) => a.name.localeCompare(b.name))
  return tree
}

export async function createFolder(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split('/')
  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
}

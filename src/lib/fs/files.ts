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

/** 'notes/Spicchio POS/commerciale/x.md' -> 'notes/Spicchio POS' (the project). */
function projectOf(dir: string): string {
  return dir.split('/').slice(0, 2).join('/')
}

/**
 * Move a markdown note to another directory. Inside the same project folder
 * (e.g. into one of its subfolders) the files stay where they are, shared
 * with the other notes, and only the relative links are rewritten. Towards
 * another project the note's local images travel along with it.
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
  if (fromDir !== toDir && projectOf(fromDir) === projectOf(toDir)) {
    out = relinkContent(content, fromDir, toDir)
  } else if (fromDir !== toDir) {
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

/** Subfolder where images dropped into documents are saved. It shows in the
 *  sidebar (to see and delete what is in there) but never receives notes. */
export const ASSETS_DIR = 'assets'

/** A folder of notes/ at any depth. `path` is from the vault root
 *  ('notes/Spicchio POS/commerciale'); notes/ itself is the tree's root node. */
export interface FolderNode {
  name: string
  path: string
  /** .md files directly inside. */
  files: string[]
  /** Every other file directly inside (images, PDFs, videos…). */
  media: string[]
  folders: FolderNode[]
}

export type NoteTree = FolderNode

export function emptyTree(): NoteTree {
  return { name: 'notes', path: 'notes', files: [], media: [], folders: [] }
}

async function listFolder(dir: FileSystemDirectoryHandle, name: string, path: string): Promise<FolderNode> {
  const node: FolderNode = { name, path, files: [], media: [], folders: [] }
  for await (const entry of dir.values()) {
    // Dotfiles (.DS_Store, .brain…) are system clutter, never content.
    if (entry.name.startsWith('.')) continue
    if (entry.kind === 'file') {
      if (entry.name.endsWith('.md')) node.files.push(entry.name)
      else node.media.push(entry.name)
    } else {
      node.folders.push(await listFolder(entry as FileSystemDirectoryHandle, entry.name, `${path}/${entry.name}`))
    }
  }
  node.media.sort((a, b) => a.localeCompare(b))
  node.folders.sort((a, b) => a.name.localeCompare(b.name))
  return node
}

/** List notes/ with all its subfolders, at any depth, assets/ included. */
export async function listNotesTree(root: FileSystemDirectoryHandle): Promise<NoteTree> {
  try {
    return await listFolder(await root.getDirectoryHandle('notes'), 'notes', 'notes')
  } catch {
    // Folder missing: treat as empty.
    return emptyTree()
  }
}

/** Every .md path in the tree, depth first. */
export function allNotePaths(node: FolderNode): string[] {
  return [...node.files.map((n) => `${node.path}/${n}`), ...node.folders.flatMap(allNotePaths)]
}

export function findFolder(node: FolderNode, path: string): FolderNode | null {
  if (node.path === path) return node
  for (const f of node.folders) {
    if (path === f.path || path.startsWith(f.path + '/')) return findFolder(f, path)
  }
  return null
}

/** True for an assets/ folder or anything inside one: no notes go there. */
export function isAssetsPath(path: string): boolean {
  return path.split('/').includes(ASSETS_DIR)
}

/** Relative path from directory `fromDir` to `to` (both vault paths). */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir.split('/').filter(Boolean)
  const b = to.split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

// Any markdown link or embed target: [x](src) and ![x](src), optional title.
const MD_LINK_RE = /(\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g

function isLocalSrc(src: string): boolean {
  return !/^(https?:|data:|blob:|mailto:|#)/.test(src) && !src.startsWith('/')
}

/** Vault path a relative link of a note in `noteDir` points to. */
export function resolveLink(noteDir: string, src: string): string {
  let decoded = src
  try {
    decoded = decodeURI(src)
  } catch {
    // Malformed escape: take it literally.
  }
  return normalizePath(`${noteDir}/${decoded}`)
}

/** Notes (vault paths) that link or embed the file at `target`. */
export async function findReferences(root: FileSystemDirectoryHandle, notePaths: string[], target: string): Promise<string[]> {
  const refs: string[] = []
  const name = target.split('/').pop()!
  for (const path of notePaths) {
    const content = await readFile(root, path)
    // Cheap pre-filter: the file name must appear somewhere in the note.
    if (!content || !content.includes(name.split('.')[0])) continue
    const dir = path.split('/').slice(0, -1).join('/')
    for (const m of content.matchAll(MD_LINK_RE)) {
      if (isLocalSrc(m[2]) && resolveLink(dir, m[2]) === target) {
        refs.push(path)
        break
      }
    }
  }
  return refs
}

/** Drop every `![alt](src)` / `[text](src)` pointing at `target` from a note's
 *  text (whole line when the embed was alone on it). */
export function stripReferences(content: string, noteDir: string, target: string): string {
  const EMBED_RE = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  return content
    .split('\n')
    .flatMap((line) => {
      let hit = false
      const out = line.replace(EMBED_RE, (whole, src: string) => {
        if (isLocalSrc(src) && resolveLink(noteDir, src) === target) {
          hit = true
          return ''
        }
        return whole
      })
      if (hit && out.trim() === '') return []
      return [hit ? out.replace(/\s+$/, '') : line]
    })
    .join('\n')
}

/**
 * A note moved from `oldDir` to `newDir`: rewrite its relative links so they
 * still reach the same files. `moved` maps old vault prefixes to new ones for
 * files that moved together with the note (a whole folder moving).
 */
export function relinkContent(content: string, oldDir: string, newDir: string, moved?: { from: string; to: string }): string {
  if (oldDir === newDir && !moved) return content
  return content.replace(MD_LINK_RE, (whole, open: string, src: string, close: string) => {
    if (!isLocalSrc(src)) return whole
    let target = resolveLink(oldDir, src)
    if (moved && (target === moved.from || target.startsWith(moved.from + '/'))) {
      target = moved.to + target.slice(moved.from.length)
    }
    const rel = relativePath(newDir, target)
    if (normalizePath(`${newDir}/${rel}`) !== target) return whole
    const encoded = encodeURI(rel)
    return resolveLink(newDir, src) === target ? whole : `${open}${encoded}${close}`
  })
}

export async function createFolder(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split('/')
  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
}

export async function folderExists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    const { dir, name } = await resolveDir(root, path)
    await dir.getDirectoryHandle(name)
    return true
  } catch {
    return false
  }
}

async function copyDirRecursive(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle): Promise<void> {
  for await (const entry of from.values()) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile()
      const target = await to.getFileHandle(entry.name, { create: true })
      const writable = await target.createWritable()
      await writable.write(file)
      await writable.close()
    } else {
      const sub = await to.getDirectoryHandle(entry.name, { create: true })
      await copyDirRecursive(entry as FileSystemDirectoryHandle, sub)
    }
  }
}

/**
 * Rename a directory in place. The File System Access API has no move()
 * for directories, so this copies the whole tree (files and subfolders,
 * assets included) into the new name and then deletes the old one.
 */
export async function renameFolder(root: FileSystemDirectoryHandle, path: string, newName: string): Promise<void> {
  const { dir, name } = await resolveDir(root, path)
  if (name === newName) return
  const from = await dir.getDirectoryHandle(name)
  const to = await dir.getDirectoryHandle(newName, { create: true })
  await copyDirRecursive(from, to)
  await dir.removeEntry(name, { recursive: true })
}

/**
 * Move a whole folder to `to` (a vault path, parent created if needed):
 * copy the tree, rewrite the relative links of every note inside so they
 * keep reaching the same files (inside the folder they move along; outside
 * they get a new ../ count), then delete the old folder.
 */
export async function moveFolderTo(root: FileSystemDirectoryHandle, from: string, to: string): Promise<void> {
  if (from === to || to.startsWith(from + '/')) return
  const { dir, name } = await resolveDir(root, from)
  const src = await dir.getDirectoryHandle(name)
  const dest = (await resolveDir(root, to, true)).dir
  const target = await dest.getDirectoryHandle(to.split('/').pop()!, { create: true })
  await copyDirRecursive(src, target)
  const moved = await listFolder(target, to.split('/').pop()!, to)
  for (const newPath of allNotePaths(moved)) {
    const content = await readFile(root, newPath)
    if (content == null) continue
    const newDir = newPath.split('/').slice(0, -1).join('/')
    const oldDir = from + newDir.slice(to.length)
    const out = relinkContent(content, oldDir, newDir, { from, to })
    if (out !== content) await writeFile(root, newPath, out)
  }
  await dir.removeEntry(name, { recursive: true })
}

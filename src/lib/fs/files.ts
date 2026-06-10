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

export async function writeFile(root: FileSystemDirectoryHandle, path: string, content: string): Promise<void> {
  const { dir, name } = await resolveDir(root, path, true)
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
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

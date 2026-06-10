import { idbGet, idbSet } from './idb'

const HANDLE_KEY = 'root-handle'

export function supportsFS(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Ask the user to pick the root folder and persist the handle. */
export async function pickRootFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await window.showDirectoryPicker({ id: 'brain-root', mode: 'readwrite' })
  await idbSet(HANDLE_KEY, handle)
  return handle
}

/**
 * Restore the persisted handle without prompting. The caller decides what
 * to do based on the current permission state.
 */
export async function restoreRootFolder(): Promise<{
  handle: FileSystemDirectoryHandle
  permission: PermissionState
} | null> {
  let handle: FileSystemDirectoryHandle | undefined
  try {
    handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY)
  } catch {
    return null
  }
  if (!handle) return null
  let permission: PermissionState = 'prompt'
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' })
  } catch {
    // Keep 'prompt': the reconnect button will requestPermission.
  }
  return { handle, permission }
}

/** One-click reconnect: requestPermission needs a user gesture. */
export async function requestRootPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

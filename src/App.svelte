<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import Sidebar from './lib/Sidebar.svelte'
  import DocView from './lib/DocView.svelte'
  import IdeasView from './lib/IdeasView.svelte'
  import Palette from './lib/palette/Palette.svelte'
  import { supportsFS, pickRootFolder, restoreRootFolder, requestRootPermission } from './lib/fs/access'
  import { ensureStructure, listMarkdown, fileExists, writeFile, readFile } from './lib/fs/files'
  import {
    appState,
    noteFiles,
    journalFiles,
    fileTitles,
    currentPath,
    paletteOpen,
    newNoteOpen,
    sidebarCollapsed,
    brainIndex,
    toast,
    showToast
  } from './lib/stores'
  import {
    buildIndex,
    loadCachedIndex,
    indexFile,
    saveIndex,
    emptyIndex,
    type BrainIndex
  } from './lib/palette/snippets'
  import type { BrainDoc } from './lib/parser/parser'

  let root: FileSystemDirectoryHandle | null = $state(null)
  let lastIndexJson = ''

  onMount(async () => {
    if (!supportsFS()) {
      appState.set('unsupported')
      return
    }
    const restored = await restoreRootFolder()
    if (!restored) {
      appState.set('welcome')
      return
    }
    root = restored.handle
    if (restored.permission === 'granted') {
      await init()
    } else {
      appState.set('reconnect')
    }
  })

  async function chooseFolder() {
    try {
      root = await pickRootFolder()
      await init()
    } catch {
      // User cancelled the picker.
    }
  }

  async function reconnect() {
    if (root && (await requestRootPermission(root))) {
      await init()
    }
  }

  // Startup reads ONLY directory listings and the last-opened file.
  // Everything else (index, other files) loads in the background.
  async function init() {
    const r = root!
    await ensureStructure(r)
    const [notes, journal] = await Promise.all([listMarkdown(r, 'notes'), listMarkdown(r, 'journal')])
    noteFiles.set(notes.sort())
    journalFiles.set(journal)
    appState.set('ready')
    const last = safeGet('brain:last-doc')
    await openPath(last ?? todayJournalPath(), true)
    scheduleIndexLoad(r)
  }

  function safeGet(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  function todayString(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  function todayJournalPath(): string {
    return `journal/${todayString()}.md`
  }

  function journalTemplate(day: string): string {
    const iso = new Date().toISOString()
    return `---\ntitle: ${day}\ntype: journal\ncreated: ${iso}\nupdated: ${iso}\n---\n\n## What happened\n\n## Notes\n`
  }

  async function openPath(path: string, fallbackToToday = false) {
    const r = root!
    if (path === 'ideas') {
      currentPath.set('ideas')
      try {
        localStorage.setItem('brain:last-doc', 'ideas')
      } catch {}
      return
    }
    if (!(await fileExists(r, path))) {
      const day = path.startsWith('journal/') ? path.slice('journal/'.length).replace(/\.md$/, '') : null
      if (day) {
        // Journal days are auto-created with the template on open.
        await writeFile(r, path, journalTemplate(day))
        journalFiles.update((l) => (l.includes(`${day}.md`) ? l : [...l, `${day}.md`]))
      } else if (fallbackToToday) {
        return openPath(todayJournalPath())
      } else {
        return
      }
    }
    currentPath.set(path)
    try {
      localStorage.setItem('brain:last-doc', path)
    } catch {}
  }

  function slugify(title: string): string {
    return (
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'note'
    )
  }

  async function createNote(title: string) {
    const r = root!
    const slug = slugify(title)
    let name = `${slug}.md`
    let n = 2
    while (await fileExists(r, `notes/${name}`)) {
      name = `${slug}-${n++}.md`
    }
    const iso = new Date().toISOString()
    await writeFile(r, `notes/${name}`, `---\ntitle: ${title}\ntype: note\ncreated: ${iso}\nupdated: ${iso}\n---\n`)
    noteFiles.update((l) => [...l, name].sort())
    fileTitles.update((t) => ({ ...t, [`notes/${name}`]: title }))
    await openPath(`notes/${name}`)
  }

  function scheduleIndexLoad(r: FileSystemDirectoryHandle) {
    // Cached index first: the palette is usable immediately.
    loadCachedIndex(r).then((idx) => {
      if (idx && !get(brainIndex)) {
        brainIndex.set(idx)
        fileTitles.update((t) => ({ ...idx.titles, ...t }))
        lastIndexJson = JSON.stringify(idx)
      }
    })
    // Full rebuild when the browser is idle.
    const idle: (cb: () => void) => void =
      'requestIdleCallback' in window
        ? (cb) => (window as Window & { requestIdleCallback(cb: () => void): number }).requestIdleCallback(cb)
        : (cb) => void setTimeout(cb, 300)
    idle(async () => {
      const idx = await buildIndex(r)
      brainIndex.set(idx)
      fileTitles.set({ ...idx.titles })
      lastIndexJson = JSON.stringify(idx)
    })
  }

  // Keep the index in sync as documents are saved.
  function onDocSaved(path: string, doc: BrainDoc) {
    const index: BrainIndex = get(brainIndex) ?? emptyIndex()
    indexFile(index, path, doc)
    brainIndex.set(index)
    fileTitles.update((t) => ({ ...t, [path]: index.titles[path] }))
    const json = JSON.stringify(index)
    if (json !== lastIndexJson && root) {
      lastIndexJson = json
      void saveIndex(root, index)
    }
  }

  async function exportJson() {
    const r = root!
    const files: Array<{ path: string; content: string }> = []
    for (const folder of ['notes', 'journal', 'ideas']) {
      for (const name of await listMarkdown(r, folder)) {
        const content = await readFile(r, `${folder}/${name}`)
        if (content != null) files.push({ path: `${folder}/${name}`, content })
      }
    }
    const payload = { app: 'brain', exportedAt: new Date().toISOString(), files }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `brain-export-${todayString()}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Exported JSON')
  }

  function onKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      if (get(appState) === 'ready') paletteOpen.update((v) => !v)
      return
    }
    if (get(appState) !== 'ready') return
    // Chrome reserves Ctrl/Cmd+N for new windows, so Alt+N is the fallback.
    if ((mod || e.altKey) && e.code === 'KeyN') {
      e.preventDefault()
      sidebarCollapsed.set(false)
      newNoteOpen.set(true)
      return
    }
    if (mod && e.code === 'KeyJ') {
      e.preventDefault()
      void openPath(todayJournalPath())
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $appState === 'unsupported'}
  <div class="center-screen">
    <h1>Brain</h1>
    <p>
      Brain stores your notes as plain files on your disk via the File System Access API,
      which this browser does not support. Please use Chrome or Edge.
    </p>
  </div>
{:else if $appState === 'welcome'}
  <div class="center-screen">
    <h1>Brain</h1>
    <p>
      Local-first notes for developers. Pick a folder — everything stays on your disk as
      plain Markdown. No accounts, no cloud, no telemetry.
    </p>
    <button class="primary" onclick={chooseFolder}>Choose a folder</button>
  </div>
{:else if $appState === 'reconnect'}
  <div class="center-screen">
    <h1>Brain</h1>
    <p>Permission to your notes folder expired with the browser session.</p>
    <button class="primary" onclick={reconnect}>Reconnect folder</button>
  </div>
{:else if $appState === 'ready'}
  <div class="app">
    {#if !$sidebarCollapsed}
      <Sidebar onopen={(p) => openPath(p)} oncreate={createNote} onexport={exportJson} />
    {:else}
      <button class="expand-btn" title="Expand sidebar" onclick={() => sidebarCollapsed.set(false)}>»</button>
    {/if}
    <main class="main">
      {#if $currentPath === 'ideas'}
        <IdeasView root={root!} />
      {:else if $currentPath}
        {#key $currentPath}
          <DocView root={root!} path={$currentPath} onsaved={onDocSaved} />
        {/key}
      {/if}
    </main>
  </div>
{/if}

{#if $paletteOpen}
  <Palette />
{/if}
{#if $toast}
  <div class="toast">{$toast}</div>
{/if}

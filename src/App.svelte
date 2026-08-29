<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { get } from 'svelte/store'
  import Sidebar from './lib/Sidebar.svelte'
  import DocView from './lib/DocView.svelte'
  import IdeasView from './lib/IdeasView.svelte'
  import FolderView from './lib/FolderView.svelte'
  import RightBar from './lib/RightBar.svelte'
  import ConfirmDialog from './lib/ConfirmDialog.svelte'
  import Palette from './lib/palette/Palette.svelte'
  import { supportsFS, pickRootFolder, restoreRootFolder, requestRootPermission } from './lib/fs/access'
  import {
    ensureStructure,
    listMarkdown,
    listNotesTree,
    createFolder,
    renameFolder,
    folderExists,
    moveNoteWithAssets,
    fileExists,
    writeFile,
    readFile,
    deleteFile
  } from './lib/fs/files'
  import {
    loadSidebarPrefs,
    saveSidebarPrefs,
    applyOrder,
    type SidebarOrder,
    type FolderColors
  } from './lib/fs/sidebar-order'
  import {
    appState,
    noteTree,
    journalFiles,
    fileTitles,
    currentPath,
    paletteOpen,
    sidebarCollapsed,
    brainIndex,
    toast,
    showToast,
    theme,
    font,
    THEMES,
    FONTS
  } from './lib/stores'
  import { t, lang, formatDayFull } from './lib/i18n'
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
  let confirmDelete: { path: string; title: string } | null = $state(null)
  let lastIndexJson = ''
  let sidebarOrder: SidebarOrder = {}
  let folderColors = $state<FolderColors>({})

  function savePrefs() {
    return saveSidebarPrefs(root!, { order: sidebarOrder, colors: folderColors })
  }

  async function setFolderColor(name: string, color: string | null) {
    if (color) folderColors[name] = color
    else delete folderColors[name]
    folderColors = { ...folderColors }
    await savePrefs()
  }

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
    const [journal, prefs] = await Promise.all([listMarkdown(r, 'journal'), loadSidebarPrefs(r)])
    sidebarOrder = prefs.order
    folderColors = prefs.colors
    await refreshNoteTree()
    journalFiles.set(journal)
    appState.set('ready')
    const last = safeGet('brain:last-doc')
    await openPath(last ?? todayJournalPath(), true)
    scheduleIndexLoad(r)
  }

  // Key for the folders' own order; ':' keeps it out of the directory keys.
  const FOLDERS_ORDER_KEY = 'notes:folders'

  /** Re-list notes/ from disk and apply the user's manual order. */
  async function refreshNoteTree() {
    const tree = await listNotesTree(root!)
    const folderNames = applyOrder(
      tree.folders.map((f) => f.name),
      sidebarOrder[FOLDERS_ORDER_KEY]
    )
    noteTree.set({
      files: applyOrder(tree.files, sidebarOrder['notes']),
      folders: folderNames.map((name) => {
        const f = tree.folders.find((t) => t.name === name)!
        return { name, files: applyOrder(f.files, sidebarOrder[`notes/${name}`]) }
      })
    })
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

  async function openPath(path: string, fallbackToToday = false, keepTrail = false) {
    // Direct navigation (sidebar, shortcuts, delete) starts a fresh page
    // history; only wiki-link hops and crumb clicks preserve the trail.
    if (!keepTrail) trail = []
    const r = root!
    if (path === 'ideas' || path === 'folder') {
      currentPath.set(path)
      // The folder page is a utility view, not a resume target.
      if (path === 'ideas') {
        try {
          localStorage.setItem('brain:last-doc', 'ideas')
        } catch {}
      }
      await scrollDocToTop()
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
    await scrollDocToTop()
  }

  // Every document opens reading from the top: no caret parked at the end
  // dragging the scroll down with it. The caret appears where you click
  // (a fresh unnamed note still focuses its title).
  async function scrollDocToTop() {
    await tick()
    mainEl?.scrollTo({ top: 0 })
  }

  // ---------- Wiki links ([[note-name]]) and their breadcrumb trail ----------

  let trail = $state<Array<{ path: string; title: string }>>([])

  /** Where the note behind a [[name]] lives: file name first (any notes/
   *  folder), then frontmatter title, then journal for date-shaped names. */
  function findNoteByName(name: string): string | null {
    const clean = name.trim()
    const tree = get(noteTree)
    const fname = `${clean}.md`
    if (tree.files.includes(fname)) return `notes/${fname}`
    for (const folder of tree.folders) {
      if (folder.files.includes(fname)) return `notes/${folder.name}/${fname}`
    }
    const lower = clean.toLowerCase()
    for (const [path, title] of Object.entries(get(fileTitles))) {
      if (title.toLowerCase() === lower) return path
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return `journal/${clean}.md`
    return null
  }

  function openWikiLink(name: string) {
    const target = findNoteByName(name)
    if (!target) {
      showToast(get(t)('toast.noteNotFound'))
      return
    }
    const cur = get(currentPath)
    if (target === cur) return
    if (cur && cur !== 'folder' && cur !== 'ideas') {
      trail = [...trail, { path: cur, title: displayTitle(cur) }]
    }
    void openPath(target, false, true)
  }

  function goBackTo(i: number) {
    const entry = trail[i]
    trail = trail.slice(0, i)
    void openPath(entry.path, false, true)
  }

  const currentCrumbTitle = $derived.by(() => {
    const p = $currentPath
    if (!p || p === 'ideas' || p === 'folder') return ''
    if (p.startsWith('journal/')) return formatDayFull(p.split('/')[1].replace(/\.md$/, ''), $lang)
    return $fileTitles[p] || p.split('/').pop()!.replace(/\.md$/, '')
  })

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
    fileTitles.update((titles) => ({ ...titles, [`notes/${name}`]: title }))
    await refreshNoteTree()
    await openPath(`notes/${name}`)
  }

  async function createNoteFolder(name: string) {
    const clean = name.replace(/[/\\]+/g, '-').trim()
    if (!clean || clean === 'assets') return
    await createFolder(root!, `notes/${clean}`)
    await refreshNoteTree()
  }

  /** Rename a notes/ subfolder, carrying manual order, titles and index along. */
  async function renameNoteFolder(oldName: string, newName: string) {
    const clean = newName.replace(/[/\\]+/g, '-').trim()
    if (!clean || clean === 'assets' || clean === oldName) return
    const r = root!
    if (await folderExists(r, `notes/${clean}`)) {
      showToast(get(t)('folder.exists'))
      return
    }
    const folder = get(noteTree).folders.find((f) => f.name === oldName)
    await renameFolder(r, `notes/${oldName}`, clean)
    if (sidebarOrder[`notes/${oldName}`]) {
      sidebarOrder[`notes/${clean}`] = sidebarOrder[`notes/${oldName}`]
      delete sidebarOrder[`notes/${oldName}`]
    }
    const folderOrder = sidebarOrder[FOLDERS_ORDER_KEY]
    if (folderOrder) {
      sidebarOrder[FOLDERS_ORDER_KEY] = folderOrder.map((n) => (n === oldName ? clean : n))
    }
    if (folderColors[oldName]) {
      folderColors[clean] = folderColors[oldName]
      delete folderColors[oldName]
      folderColors = { ...folderColors }
    }
    await savePrefs()
    for (const file of folder?.files ?? []) {
      renamePathEverywhere(`notes/${oldName}/${file}`, `notes/${clean}/${file}`)
    }
    // The resume target may point into the renamed folder (this page is
    // open instead of a document, so renamePathEverywhere can't catch it).
    const last = safeGet('brain:last-doc')
    if (last?.startsWith(`notes/${oldName}/`)) {
      try {
        localStorage.setItem('brain:last-doc', `notes/${clean}/` + last.slice(`notes/${oldName}/`.length))
      } catch {}
    }
    await refreshNoteTree()
    showToast(get(t)('toast.renamed'))
  }

  // ---------- Sidebar drag & drop: reorder and move between folders ----------

  function orderedFilesOf(dir: string): string[] {
    const tree = get(noteTree)
    if (dir === 'notes') return [...tree.files]
    const folder = tree.folders.find((f) => `notes/${f.name}` === dir)
    return folder ? [...folder.files] : []
  }

  async function moveNote(path: string, targetDir: string, beforeName: string | null) {
    const r = root!
    const name = path.split('/').pop()!
    const fromDir = path.split('/').slice(0, -1).join('/')

    // Physical move when the note changes folder (images travel along).
    let finalName = name
    if (fromDir !== targetDir) {
      const stem = name.replace(/\.md$/, '')
      let n = 2
      while (await fileExists(r, `${targetDir}/${finalName}`)) {
        finalName = `${stem}-${n++}.md`
      }
      const newPath = `${targetDir}/${finalName}`
      await moveNoteWithAssets(r, path, newPath)
      renamePathEverywhere(path, newPath)
    }

    // Manual order: remove from the source list, insert in the target list.
    const fromList = orderedFilesOf(fromDir).filter((f) => f !== name)
    const targetList = fromDir === targetDir ? fromList : orderedFilesOf(targetDir).filter((f) => f !== finalName)
    const at = beforeName ? targetList.indexOf(beforeName) : -1
    if (at >= 0) targetList.splice(at, 0, finalName)
    else targetList.push(finalName)
    sidebarOrder[fromDir] = fromDir === targetDir ? targetList : fromList
    sidebarOrder[targetDir] = targetList
    await savePrefs()
    await refreshNoteTree()
  }

  async function moveFolder(name: string, beforeName: string | null) {
    const names = get(noteTree)
      .folders.map((f) => f.name)
      .filter((n) => n !== name)
    const at = beforeName ? names.indexOf(beforeName) : -1
    if (at >= 0) names.splice(at, 0, name)
    else names.push(name)
    sidebarOrder[FOLDERS_ORDER_KEY] = names
    await savePrefs()
    await refreshNoteTree()
  }

  /** Keep titles, index and the open document pointing at a renamed path. */
  function renamePathEverywhere(oldPath: string, newPath: string) {
    fileTitles.update((titles) => {
      if (!(oldPath in titles)) return titles
      const copy = { ...titles, [newPath]: titles[oldPath] }
      delete copy[oldPath]
      return copy
    })
    const idx = get(brainIndex)
    if (idx && root) {
      if (idx.titles[oldPath] != null) {
        idx.titles[newPath] = idx.titles[oldPath]
        delete idx.titles[oldPath]
      }
      for (const s of idx.snippets) {
        if (s.file === oldPath) s.file = newPath
      }
      brainIndex.set(idx)
      lastIndexJson = JSON.stringify(idx)
      void saveIndex(root, idx)
    }
    if (get(currentPath) === oldPath) {
      currentPath.set(newPath)
      try {
        localStorage.setItem('brain:last-doc', newPath)
      } catch {}
    }
  }

  function scheduleIndexLoad(r: FileSystemDirectoryHandle) {
    // Cached index first: the palette is usable immediately.
    loadCachedIndex(r).then((idx) => {
      if (idx && !get(brainIndex)) {
        brainIndex.set(idx)
        fileTitles.update((titles) => ({ ...idx.titles, ...titles }))
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
    fileTitles.update((titles) => ({ ...titles, [path]: index.titles[path] }))
    const json = JSON.stringify(index)
    if (json !== lastIndexJson && root) {
      lastIndexJson = json
      void saveIndex(root, index)
    }
  }

  // ---------- Delete with custom confirmation ----------

  function displayTitle(path: string): string {
    if (path.startsWith('journal/')) {
      return formatDayFull(path.split('/')[1].replace(/\.md$/, ''), get(lang))
    }
    return get(fileTitles)[path] || path.split('/').pop()!.replace(/\.md$/, '')
  }

  function requestDelete() {
    const path = get(currentPath)
    if (!path || path === 'ideas' || path === 'folder') return
    confirmDelete = { path, title: displayTitle(path) }
  }

  async function confirmDeleteNow() {
    if (!confirmDelete || !root) return
    const { path } = confirmDelete
    confirmDelete = null
    await deleteFile(root, path)
    if (path.startsWith('notes/')) {
      await refreshNoteTree()
    }
    if (path.startsWith('journal/')) {
      const name = path.slice('journal/'.length)
      journalFiles.update((l) => l.filter((n) => n !== name))
    }
    const idx = get(brainIndex)
    if (idx) {
      idx.snippets = idx.snippets.filter((s) => s.file !== path)
      delete idx.titles[path]
      brainIndex.set(idx)
      lastIndexJson = JSON.stringify(idx)
      void saveIndex(root, idx)
    }
    fileTitles.update((titles) => {
      const copy = { ...titles }
      delete copy[path]
      return copy
    })
    showToast(get(t)('toast.deleted'))
    await openPath(todayJournalPath())
  }

  // ---------- Right bar actions ----------

  let mainEl: HTMLElement | null = $state(null)

  function scrollToTop() {
    mainEl?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function downloadTxt() {
    const path = get(currentPath)
    if (!path || path === 'folder' || !root) return
    const filePath = path === 'ideas' ? 'ideas/ideas.md' : path
    const content = await readFile(root, filePath)
    if (content == null) return
    const base = filePath.split('/').pop()!.replace(/\.md$/, '')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${base}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function cycleTheme() {
    theme.update((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length])
  }

  function cycleFont() {
    font.update((current) => FONTS[(FONTS.indexOf(current) + 1) % FONTS.length])
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
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
    showToast(get(t)('toast.exported'))
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
      void createNote('')
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
    <p>{$t('screen.unsupported')}</p>
  </div>
{:else if $appState === 'welcome'}
  <div class="center-screen">
    <h1>Brain</h1>
    <p>{$t('screen.welcome')}</p>
    <button class="primary" onclick={chooseFolder}>{$t('screen.choose')}</button>
  </div>
{:else if $appState === 'reconnect'}
  <div class="center-screen">
    <h1>Brain</h1>
    <p>{$t('screen.reconnectMsg')}</p>
    <button class="primary" onclick={reconnect}>{$t('screen.reconnect')}</button>
  </div>
{:else if $appState === 'ready'}
  <div class="app">
    {#if !$sidebarCollapsed}
      <Sidebar
        rootName={root?.name ?? ''}
        colors={folderColors}
        onopen={(p) => openPath(p)}
        oncreate={createNote}
        oncreatefolder={createNoteFolder}
        onmovenote={moveNote}
        onmovefolder={moveFolder}
        oncolor={setFolderColor}
        onexport={exportJson}
      />
    {:else}
      <button class="expand-btn" title={$t('sidebar.expand')} onclick={() => sidebarCollapsed.set(false)}>»</button>
    {/if}
    <main class="main" bind:this={mainEl}>
      {#if trail.length > 0}
        <nav class="crumbs">
          {#each trail as entry, i (i)}
            <button class="crumb" onclick={() => goBackTo(i)}>{entry.title}</button>
            <span class="crumb-sep">›</span>
          {/each}
          <span class="crumb-here">{currentCrumbTitle}</span>
        </nav>
      {/if}
      {#if $currentPath === 'ideas'}
        <IdeasView root={root!} />
      {:else if $currentPath === 'folder'}
        <FolderView root={root!} onchangefolder={chooseFolder} onrenamefolder={renameNoteFolder} />
      {:else if $currentPath}
        {#key $currentPath}
          <DocView
            root={root!}
            path={$currentPath}
            onsaved={onDocSaved}
            onrequestdelete={requestDelete}
            onnavigate={openWikiLink}
          />
        {/key}
      {/if}
    </main>
    <RightBar
      onscrolltop={scrollToTop}
      ondownload={downloadTxt}
      oncycletheme={cycleTheme}
      oncyclefont={cycleFont}
      onfullscreen={toggleFullscreen}
    />
  </div>
{/if}

{#if confirmDelete}
  <ConfirmDialog
    title={$t('doc.deleteTitle')}
    message={$t('doc.deleteMsg').replace('{name}', confirmDelete.title)}
    confirmLabel={$t('doc.delete')}
    cancelLabel={$t('doc.cancel')}
    onconfirm={confirmDeleteNow}
    oncancel={() => (confirmDelete = null)}
  />
{/if}
{#if $paletteOpen}
  <Palette />
{/if}
{#if $toast}
  <div class="toast">{$toast}</div>
{/if}

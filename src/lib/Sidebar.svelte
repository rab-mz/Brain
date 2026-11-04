<script lang="ts">
  import { noteTree, journalFiles, fileTitles, currentPath, sidebarCollapsed, sideOpen, newNoteDir, toggleFolder } from './stores'
  import { isAssetsPath, type FolderNode } from './fs/files'
  import { kindOfName, KIND_COLORS, KIND_ICONS } from './filetypes'
  import { t, lang, formatDayList, formatDayShort, formatMonth, type Lang } from './i18n'
  import { focusOnMount } from './actions'
  import { autoFolderColor, type FolderColors } from './fs/sidebar-order'
  import FolderIcon from './FolderIcon.svelte'

  let {
    rootName,
    colors = {},
    onopen,
    oncreate,
    oncreatefolder,
    onmovenote,
    onmovefolder,
    oncolor,
    onexport
  }: {
    rootName: string
    /** Manual folder colors; folders not listed get an automatic hue. */
    colors?: FolderColors
    onopen: (path: string) => void
    /** dir: 'notes' or any folder path under it. */
    oncreate: (title: string, dir: string) => void
    /** New folder `name` inside `parentDir`. */
    oncreatefolder: (name: string, parentDir: string) => void
    /** Move/reorder: beforeName === null appends at the end of targetDir. */
    onmovenote: (path: string, targetDir: string, beforeName: string | null) => void
    /** Folder `path` ends up in `targetDir`, before sibling `beforeName`
     *  (null = at the end). Same parent = reorder, else a real move. */
    onmovefolder: (path: string, targetDir: string, beforeName: string | null) => void
    /** Pick a folder color (key = path under notes/); null = automatic. */
    oncolor: (rel: string, color: string | null) => void
    onexport: () => void
  } = $props()

  // ---------- Folder colors (right-click a folder to pick) ----------

  /** Manual pick, else the parent's color (a project's subfolders share
   *  its hue), else the automatic hue of a top-level folder. */
  function folderColor(rel: string): string {
    if (colors[rel]) return colors[rel]
    const parent = rel.split('/').slice(0, -1).join('/')
    return parent ? folderColor(parent) : autoFolderColor(rel)
  }

  const relOf = (path: string) => path.slice('notes/'.length)

  /** Notes inside, at any depth; for a folder with no notes (assets/), its files. */
  function countOf(node: FolderNode): number {
    const notes = (n: FolderNode): number => n.files.length + n.folders.reduce((s, f) => s + notes(f), 0)
    const media = (n: FolderNode): number => n.media.length + n.folders.reduce((s, f) => s + media(f), 0)
    return notes(node) || media(node)
  }

  const SWATCHES = ['#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#0091ff', '#6e56cf', '#e93d82', '#8d8d8d']

  let colorPick = $state<{ name: string; x: number; y: number } | null>(null)

  function openColorPick(e: MouseEvent, name: string) {
    e.preventDefault()
    colorPick = { name, x: e.clientX, y: e.clientY }
  }

  /** The native color input wants #rrggbb; normalize hsl() through canvas. */
  function toHex(color: string): string {
    if (color.startsWith('#')) return color
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = color
    return ctx.fillStyle
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (colorPick && !(e.target as HTMLElement).closest('.color-pop')) colorPick = null
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') colorPick = null
  }

  let newFolderOpen = $state(false)
  let newFolderName = $state('')

  function todayString(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const today = todayString()
  const currentYear = today.slice(0, 4)

  // ---------- Collapsible state (persisted per browser, see sideOpen) ----------

  function isOpen(key: string): boolean {
    return $sideOpen.includes(key)
  }

  function toggleOpen(key: string) {
    sideOpen.update((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }

  // One folder open at a time (with the folders containing it): that is the
  // selection, and both "+" buttons create inside it. The tooltips say where.
  const newDir = $derived(newNoteDir($sideOpen))
  const newDirLabel = $derived(newDir.split('/').slice(1).join(' / '))
  const newNoteTip = $derived(
    newDir === 'notes' ? $t('sidebar.newNote') : $t('sidebar.newNoteIn').replace('{name}', newDirLabel)
  )
  const newFolderTip = $derived(
    newDir === 'notes' ? $t('sidebar.newFolder') : $t('sidebar.newFolderIn').replace('{name}', newDirLabel)
  )

  // ---------- Journal grouped by year -> month -> day ----------

  interface MonthGroup {
    month: string
    days: string[]
  }
  interface YearGroup {
    year: string
    months: MonthGroup[]
  }

  const journalYears = $derived.by((): YearGroup[] => {
    const days = new Set($journalFiles.map((n) => n.replace(/\.md$/, '')))
    days.add(today)
    const sorted = [...days].sort().reverse()
    const years: YearGroup[] = []
    for (const day of sorted) {
      const y = day.slice(0, 4)
      const m = day.slice(0, 7)
      let year = years[years.length - 1]
      if (!year || year.year !== y) {
        year = { year: y, months: [] }
        years.push(year)
      }
      let month = year.months[year.months.length - 1]
      if (!month || month.month !== m) {
        month = { month: m, days: [] }
        year.months.push(month)
      }
      month.days.push(day)
    }
    return years
  })

  function onNewFolderKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const name = newFolderName.trim()
      // The app opens the freshly created folder, ready for drops.
      if (name) oncreatefolder(name, newDir)
      newFolderName = ''
      newFolderOpen = false
    } else if (e.key === 'Escape') {
      newFolderName = ''
      newFolderOpen = false
    }
  }

  function noteLabel(path: string): string {
    // `||`, not `??`: a freshly created note has an empty title until named.
    return $fileTitles[path] || path.split('/').pop()!.replace(/\.md$/, '')
  }

  function dayLabel(day: string, l: Lang): string {
    if (day === today) return `${$t('sidebar.today')} · ${formatDayList(day, l)}`
    return formatDayShort(day, l)
  }

  function toggleLang() {
    lang.update((l) => (l === 'en' ? 'it' : 'en'))
  }

  // ---------- Drag & drop: reorder notes, move them into folders ----------

  const NOTE_MIME = 'application/x-brain-note'
  const FOLDER_MIME = 'application/x-brain-folder'

  let dropBefore = $state<string | null>(null) // path of the item showing the insert line
  let dropInto = $state<string | null>(null) // folder dir highlighted as target
  let dropBeforeFolder = $state<string | null>(null) // folder showing the insert line
  let dragging = $state(false)

  function onDragStart(e: DragEvent, path: string) {
    dragging = true
    e.dataTransfer?.setData(NOTE_MIME, path)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onFolderDragStart(e: DragEvent, path: string) {
    dragging = true
    e.dataTransfer?.setData(FOLDER_MIME, path)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onDragEnd() {
    dragging = false
    dropBefore = null
    dropInto = null
    dropBeforeFolder = null
  }

  function acceptNote(e: DragEvent): boolean {
    return e.dataTransfer?.types.includes(NOTE_MIME) ?? false
  }

  function onItemDragOver(e: DragEvent, path: string) {
    if (!acceptNote(e)) return
    e.preventDefault()
    e.stopPropagation()
    dropBefore = path
    dropInto = null
  }

  function onItemDrop(e: DragEvent, targetPath: string) {
    e.preventDefault()
    e.stopPropagation()
    const path = e.dataTransfer?.getData(NOTE_MIME)
    onDragEnd()
    if (!path || path === targetPath) return
    const targetDir = targetPath.split('/').slice(0, -1).join('/')
    onmovenote(path, targetDir, targetPath.split('/').pop()!)
  }

  function onDirDragOver(e: DragEvent, dir: string) {
    if (!acceptNote(e) || isAssetsPath(dir)) return
    e.preventDefault()
    e.stopPropagation()
    dropInto = dir
    dropBefore = null
  }

  function onDirDrop(e: DragEvent, dir: string) {
    e.preventDefault()
    e.stopPropagation()
    const path = e.dataTransfer?.getData(NOTE_MIME)
    onDragEnd()
    if (!path) return
    onmovenote(path, dir, null)
  }

  // A folder header accepts two payloads: a note (goes inside the folder)
  // or another folder: dropped on the top edge it is inserted before this
  // one (same level), anywhere else it goes inside this folder.
  function folderZoneIsBefore(e: DragEvent): boolean {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return e.clientY - r.top < r.height * 0.35
  }

  function onFolderHeaderDragOver(e: DragEvent, path: string) {
    const types = e.dataTransfer?.types ?? []
    if (types.includes(FOLDER_MIME)) {
      e.preventDefault()
      e.stopPropagation()
      if (folderZoneIsBefore(e) || isAssetsPath(path)) {
        dropBeforeFolder = path
        dropInto = null
      } else {
        dropInto = path
        dropBeforeFolder = null
      }
      dropBefore = null
    } else {
      onDirDragOver(e, path)
    }
  }

  function onFolderHeaderDrop(e: DragEvent, path: string) {
    e.preventDefault()
    e.stopPropagation()
    const folderPath = e.dataTransfer?.getData(FOLDER_MIME)
    const notePath = e.dataTransfer?.getData(NOTE_MIME)
    const before = dropBeforeFolder === path
    onDragEnd()
    if (folderPath) {
      if (folderPath === path) return
      const parent = path.split('/').slice(0, -1).join('/')
      if (before) onmovefolder(folderPath, parent, path.split('/').pop()!)
      else onmovefolder(folderPath, path, null)
    } else if (notePath && !isAssetsPath(path)) {
      onmovenote(notePath, path, null)
    }
  }

  function onSectionDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes(FOLDER_MIME)) {
      e.preventDefault()
      return
    }
    onDirDragOver(e, 'notes')
  }

  function onSectionDrop(e: DragEvent) {
    const folderPath = e.dataTransfer?.getData(FOLDER_MIME)
    if (folderPath) {
      e.preventDefault()
      onDragEnd()
      onmovefolder(folderPath, 'notes', null)
      return
    }
    onDirDrop(e, 'notes')
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<aside class="sidebar">
  <div class="side-head">
    <span class="logo">Brain</span>
    <button class="icon-btn" title={$t('sidebar.collapse')} onclick={() => sidebarCollapsed.set(true)}>«</button>
  </div>

  <nav class="side-scroll">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section
      class="side-section"
      class:drop-into={dragging && dropInto === 'notes'}
      ondragover={onSectionDragOver}
      ondrop={onSectionDrop}
    >
      <div class="side-title">
        {$t('sidebar.notes')}
        <span class="title-actions">
          <button class="icon-btn" data-tip={newFolderTip} onclick={() => (newFolderOpen = true)}>
            <FolderIcon plus />
          </button>
          <button class="icon-btn" data-tip={newNoteTip} onclick={() => oncreate('', newDir)}>+</button>
        </span>
      </div>
      {#if newFolderOpen}
        <input
          class="new-note-input"
          use:focusOnMount
          bind:value={newFolderName}
          placeholder={$t('sidebar.newFolderPh')}
          onkeydown={onNewFolderKeydown}
          onblur={() => (newFolderOpen = false)}
        />
      {/if}
      <ul>
        {#each $noteTree.folders as folder (folder.path)}
          {@render folderItem(folder)}
        {/each}
        {#each $noteTree.files as name (name)}
          {@const path = `notes/${name}`}
          <li>
            <button
              class="side-item"
              class:active={$currentPath === path}
              class:drop-before={dropBefore === path}
              draggable="true"
              onclick={() => onopen(path)}
              ondragstart={(e) => onDragStart(e, path)}
              ondragend={onDragEnd}
              ondragover={(e) => onItemDragOver(e, path)}
              ondrop={(e) => onItemDrop(e, path)}
            >
              {noteLabel(path)}
            </button>
          </li>
        {/each}
        {#if $noteTree.files.length === 0 && $noteTree.folders.length === 0}
          <li class="side-empty">{$t('sidebar.noNotes')}</li>
        {/if}
      </ul>
    </section>

    <section class="side-section">
      <div class="side-title">{$t('sidebar.journal')}</div>
      <ul>
        <li>
          <button
            class="side-item"
            class:active={$currentPath === `journal/${today}.md`}
            onclick={() => onopen(`journal/${today}.md`)}
          >
            {dayLabel(today, $lang)}
          </button>
        </li>
        {#each journalYears as yearGroup (yearGroup.year)}
          {#if yearGroup.year === currentYear}
            {#each yearGroup.months as monthGroup (monthGroup.month)}
              {@render month(monthGroup)}
            {/each}
          {:else}
            <li>
              <button
                class="side-item side-group"
                class:open={isOpen(`year:${yearGroup.year}`)}
                onclick={() => toggleOpen(`year:${yearGroup.year}`)}
              >
                <span class="chev">{isOpen(`year:${yearGroup.year}`) ? '▾' : '▸'}</span>
                {yearGroup.year}
              </button>
              {#if isOpen(`year:${yearGroup.year}`)}
                <ul class="side-nested">
                  {#each yearGroup.months as monthGroup (monthGroup.month)}
                    {@render month(monthGroup)}
                  {/each}
                </ul>
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
    </section>

    <section class="side-section">
      <div class="side-title">{$t('sidebar.ideas')}</div>
      <ul>
        <li>
          <button class="side-item" class:active={$currentPath === 'ideas'} onclick={() => onopen('ideas')}>
            {$t('sidebar.ideaStream')}
          </button>
        </li>
      </ul>
    </section>
  </nav>

  <div class="side-foot">
    <button
      class="foot-btn folder-btn"
      class:active={$currentPath === 'folder'}
      title={$t('folder.title')}
      onclick={() => onopen('folder')}
    >
      <FolderIcon />
      {rootName}
    </button>
    <button class="foot-btn" onclick={toggleLang}>{$t('lang.switch')}</button>
    <button class="foot-btn" onclick={onexport}>{$t('sidebar.export')}</button>
    <p class="side-hint">{$t('sidebar.hint')}</p>
  </div>
</aside>

{#if colorPick}
  {@const pick = colorPick}
  <div class="color-pop" style="left: {Math.min(pick.x, window.innerWidth - 236)}px; top: {Math.min(pick.y, window.innerHeight - 110)}px">
    <div class="color-row">
      {#each SWATCHES as c (c)}
        <button
          class="color-swatch"
          class:sel={colors[pick.name] === c}
          style="background: {c}"
          aria-label={c}
          onclick={() => {
            oncolor(pick.name, c)
            colorPick = null
          }}
        ></button>
      {/each}
    </div>
    <div class="color-actions">
      <label class="color-custom">
        <span class="color-swatch color-rainbow" aria-hidden="true"></span>
        {$t('folder.colorCustom')}
        <input
          type="color"
          value={toHex(folderColor(pick.name))}
          onchange={(e) => oncolor(pick.name, (e.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <button
        class="color-auto"
        onclick={() => {
          oncolor(pick.name, null)
          colorPick = null
        }}
      >
        {$t('folder.colorAuto')}
      </button>
    </div>
  </div>
{/if}

{#snippet folderItem(folder: FolderNode)}
  {@const dir = folder.path}
  {@const rel = relOf(folder.path)}
  {@const open = isOpen(`folder:${rel}`)}
  <li class="folder-li" class:open class:assets-li={folder.name === 'assets'} style="--fc: {folderColor(rel)}">
    <button
      class="side-item side-group"
      class:open
      class:drop-into={dropInto === dir}
      class:drop-before={dropBeforeFolder === dir}
      draggable={!isAssetsPath(dir)}
      onclick={() => toggleFolder(rel)}
      oncontextmenu={(e) => openColorPick(e, rel)}
      ondragstart={(e) => onFolderDragStart(e, dir)}
      ondragend={onDragEnd}
      ondragover={(e) => onFolderHeaderDragOver(e, dir)}
      ondrop={(e) => onFolderHeaderDrop(e, dir)}
    >
      <span class="chev">{open ? '▾' : '▸'}</span>
      <FolderIcon {open} />
      <span class="group-name">{folder.name}</span>
      <span class="group-count">{countOf(folder)}</span>
    </button>
    {#if open}
      <ul class="side-nested">
        {#each folder.folders as sub (sub.path)}
          {@render folderItem(sub)}
        {/each}
        {#each folder.files as name (name)}
          {@const path = `${dir}/${name}`}
          <li>
            <button
              class="side-item"
              class:active={$currentPath === path}
              class:drop-before={dropBefore === path}
              draggable="true"
              onclick={() => onopen(path)}
              ondragstart={(e) => onDragStart(e, path)}
              ondragend={onDragEnd}
              ondragover={(e) => onItemDragOver(e, path)}
              ondrop={(e) => onItemDrop(e, path)}
            >
              {noteLabel(path)}
            </button>
          </li>
        {/each}
        {#each folder.media as name (name)}
          {@const path = `${dir}/${name}`}
          {@const kind = kindOfName(name)}
          <li>
            <button
              class="side-item side-file"
              class:active={$currentPath === path}
              title={name}
              onclick={() => onopen(path)}
            >
              <span class="file-icon" style="color: {kind ? KIND_COLORS[kind] : 'var(--muted)'}">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from filetypes.ts -->
                {@html KIND_ICONS[kind ?? 'text']}
              </span>
              <span class="file-name">{name}</span>
            </button>
          </li>
        {/each}
        {#if folder.files.length === 0 && folder.media.length === 0 && folder.folders.length === 0}
          <li class="side-empty">{$t('sidebar.emptyFolder')}</li>
        {/if}
      </ul>
    {/if}
  </li>
{/snippet}

{#snippet month(monthGroup: { month: string; days: string[] })}
  {@const visibleDays = monthGroup.days.filter((d) => d !== today)}
  {#if visibleDays.length > 0}
    <li>
      <button
        class="side-item side-group"
        class:open={isOpen(`month:${monthGroup.month}`)}
        onclick={() => toggleOpen(`month:${monthGroup.month}`)}
      >
        <span class="chev">{isOpen(`month:${monthGroup.month}`) ? '▾' : '▸'}</span>
        {formatMonth(monthGroup.month, $lang)}
        <span class="group-count">{visibleDays.length}</span>
      </button>
      {#if isOpen(`month:${monthGroup.month}`)}
        <ul class="side-nested">
          {#each visibleDays as day (day)}
            <li>
              <button
                class="side-item"
                class:active={$currentPath === `journal/${day}.md`}
                onclick={() => onopen(`journal/${day}.md`)}
              >
                {dayLabel(day, $lang)}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </li>
  {/if}
{/snippet}

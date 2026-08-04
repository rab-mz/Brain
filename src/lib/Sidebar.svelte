<script lang="ts">
  import { noteTree, journalFiles, fileTitles, currentPath, sidebarCollapsed } from './stores'
  import { t, lang, formatDayList, formatDayShort, formatMonth, type Lang } from './i18n'
  import { focusOnMount } from './actions'
  import FolderIcon from './FolderIcon.svelte'

  let {
    rootName,
    onopen,
    oncreate,
    oncreatefolder,
    onmovenote,
    onmovefolder,
    onexport
  }: {
    rootName: string
    onopen: (path: string) => void
    oncreate: (title: string) => void
    oncreatefolder: (name: string) => void
    /** Move/reorder: beforeName === null appends at the end of targetDir. */
    onmovenote: (path: string, targetDir: string, beforeName: string | null) => void
    /** Reorder folders: beforeName === null appends at the end. */
    onmovefolder: (name: string, beforeName: string | null) => void
    onexport: () => void
  } = $props()

  let newFolderOpen = $state(false)
  let newFolderName = $state('')

  function todayString(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const today = todayString()
  const currentMonth = today.slice(0, 7)
  const currentYear = today.slice(0, 4)

  // ---------- Collapsible state (persisted per browser) ----------

  const OPEN_KEY = 'brain:side-open'

  function loadOpen(): string[] {
    try {
      const raw = localStorage.getItem(OPEN_KEY)
      const parsed = raw ? (JSON.parse(raw) as string[]) : []
      const keys = Array.isArray(parsed) ? parsed : []
      // The current month is always worth a look.
      const monthKey = `month:${currentMonth}`
      return keys.includes(monthKey) ? keys : [...keys, monthKey]
    } catch {
      return [`month:${currentMonth}`]
    }
  }

  let openKeys = $state<string[]>(loadOpen())

  function isOpen(key: string): boolean {
    return openKeys.includes(key)
  }

  function toggleOpen(key: string) {
    openKeys = isOpen(key) ? openKeys.filter((k) => k !== key) : [...openKeys, key]
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openKeys))
    } catch {
      // Ignore: state just won't persist.
    }
  }

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
      if (name) {
        oncreatefolder(name)
        // Show the freshly created folder open, ready for drops.
        if (!isOpen(`folder:${name}`)) toggleOpen(`folder:${name}`)
      }
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

  function onFolderDragStart(e: DragEvent, name: string) {
    dragging = true
    e.dataTransfer?.setData(FOLDER_MIME, name)
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
    if (!acceptNote(e)) return
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
  // or another folder (reorders, inserting before this one).
  function onFolderHeaderDragOver(e: DragEvent, name: string, dir: string) {
    const types = e.dataTransfer?.types ?? []
    if (types.includes(FOLDER_MIME)) {
      e.preventDefault()
      e.stopPropagation()
      dropBeforeFolder = name
      dropInto = null
      dropBefore = null
    } else {
      onDirDragOver(e, dir)
    }
  }

  function onFolderHeaderDrop(e: DragEvent, name: string, dir: string) {
    e.preventDefault()
    e.stopPropagation()
    const folderName = e.dataTransfer?.getData(FOLDER_MIME)
    const notePath = e.dataTransfer?.getData(NOTE_MIME)
    onDragEnd()
    if (folderName) {
      if (folderName !== name) onmovefolder(folderName, name)
    } else if (notePath) {
      onmovenote(notePath, dir, null)
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
    const folderName = e.dataTransfer?.getData(FOLDER_MIME)
    if (folderName) {
      e.preventDefault()
      onDragEnd()
      onmovefolder(folderName, null)
      return
    }
    onDirDrop(e, 'notes')
  }
</script>

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
          <button class="icon-btn" data-tip={$t('sidebar.newFolder')} onclick={() => (newFolderOpen = true)}>
            <FolderIcon plus />
          </button>
          <button class="icon-btn" data-tip={$t('sidebar.newNote')} onclick={() => oncreate('')}>+</button>
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
        {#each $noteTree.folders as folder (folder.name)}
          {@const dir = `notes/${folder.name}`}
          <li>
            <button
              class="side-item side-group"
              class:drop-into={dropInto === dir}
              class:drop-before={dropBeforeFolder === folder.name}
              draggable="true"
              onclick={() => toggleOpen(`folder:${folder.name}`)}
              ondragstart={(e) => onFolderDragStart(e, folder.name)}
              ondragend={onDragEnd}
              ondragover={(e) => onFolderHeaderDragOver(e, folder.name, dir)}
              ondrop={(e) => onFolderHeaderDrop(e, folder.name, dir)}
            >
              <span class="chev">{isOpen(`folder:${folder.name}`) ? '▾' : '▸'}</span>
              <FolderIcon />
              {folder.name}
              <span class="group-count">{folder.files.length}</span>
            </button>
            {#if isOpen(`folder:${folder.name}`)}
              <ul class="side-nested">
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
                {#if folder.files.length === 0}
                  <li class="side-empty">{$t('sidebar.emptyFolder')}</li>
                {/if}
              </ul>
            {/if}
          </li>
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
              <button class="side-item side-group" onclick={() => toggleOpen(`year:${yearGroup.year}`)}>
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

{#snippet month(monthGroup: { month: string; days: string[] })}
  {@const visibleDays = monthGroup.days.filter((d) => d !== today)}
  {#if visibleDays.length > 0}
    <li>
      <button class="side-item side-group" onclick={() => toggleOpen(`month:${monthGroup.month}`)}>
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

<script lang="ts">
  import { noteFiles, journalFiles, fileTitles, currentPath, sidebarCollapsed, newNoteOpen } from './stores'
  import { t, lang, formatDayList, type Lang } from './i18n'
  import { focusOnMount } from './actions'

  let {
    rootName,
    onopen,
    oncreate,
    onexport
  }: {
    rootName: string
    onopen: (path: string) => void
    oncreate: (title: string) => void
    onexport: () => void
  } = $props()

  let newTitle = $state('')

  function todayString(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  const today = todayString()

  const journalDays = $derived.by(() => {
    const days = $journalFiles.map((n) => n.replace(/\.md$/, ''))
    if (!days.includes(today)) days.push(today)
    return days.sort().reverse()
  })

  function onNewNoteKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      const title = newTitle.trim()
      if (title) oncreate(title)
      newTitle = ''
      newNoteOpen.set(false)
    } else if (e.key === 'Escape') {
      newTitle = ''
      newNoteOpen.set(false)
    }
  }

  function noteLabel(name: string): string {
    return $fileTitles[`notes/${name}`] ?? name.replace(/\.md$/, '')
  }

  function dayLabel(day: string, l: Lang): string {
    const formatted = formatDayList(day, l)
    if (day === today) return `${$t('sidebar.today')} · ${formatted}`
    return formatted
  }

  function toggleLang() {
    lang.update((l) => (l === 'en' ? 'it' : 'en'))
  }
</script>

<aside class="sidebar">
  <div class="side-head">
    <span class="logo">Brain</span>
    <button class="icon-btn" title={$t('sidebar.collapse')} onclick={() => sidebarCollapsed.set(true)}>«</button>
  </div>

  <nav class="side-scroll">
    <section class="side-section">
      <div class="side-title">
        {$t('sidebar.notes')}
        <button class="icon-btn" title={$t('sidebar.newNote')} onclick={() => newNoteOpen.set(true)}>+</button>
      </div>
      {#if $newNoteOpen}
        <input
          class="new-note-input"
          use:focusOnMount
          bind:value={newTitle}
          placeholder={$t('sidebar.newNotePh')}
          onkeydown={onNewNoteKeydown}
          onblur={() => newNoteOpen.set(false)}
        />
      {/if}
      <ul>
        {#each $noteFiles as name}
          <li>
            <button
              class="side-item"
              class:active={$currentPath === `notes/${name}`}
              onclick={() => onopen(`notes/${name}`)}
            >
              {noteLabel(name)}
            </button>
          </li>
        {/each}
        {#if $noteFiles.length === 0}
          <li class="side-empty">{$t('sidebar.noNotes')}</li>
        {/if}
      </ul>
    </section>

    <section class="side-section">
      <div class="side-title">{$t('sidebar.journal')}</div>
      <ul>
        {#each journalDays as day}
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
      📁 {rootName}
    </button>
    <button class="foot-btn" onclick={toggleLang}>{$t('lang.switch')}</button>
    <button class="foot-btn" onclick={onexport}>{$t('sidebar.export')}</button>
    <p class="side-hint">{$t('sidebar.hint')}</p>
  </div>
</aside>

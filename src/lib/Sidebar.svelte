<script lang="ts">
  import {
    noteFiles,
    journalFiles,
    fileTitles,
    currentPath,
    sidebarCollapsed,
    newNoteOpen,
    theme
  } from './stores'
  import { focusOnMount } from './actions'

  let {
    onopen,
    oncreate,
    onexport
  }: {
    onopen: (path: string) => void
    oncreate: (title: string) => void
    onexport: () => void
  } = $props()

  let newTitle = $state('')

  function todayString(): string {
    const d = new Date()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${mm}-${dd}`
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
</script>

<aside class="sidebar">
  <div class="side-head">
    <span class="logo">Brain</span>
    <button class="icon-btn" title="Collapse sidebar" onclick={() => sidebarCollapsed.set(true)}>«</button>
  </div>

  <nav class="side-scroll">
    <section class="side-section">
      <div class="side-title">
        Notes
        <button class="icon-btn" title="New note (Ctrl/Cmd+N or Alt+N)" onclick={() => newNoteOpen.set(true)}>+</button>
      </div>
      {#if $newNoteOpen}
        <input
          class="new-note-input"
          use:focusOnMount
          bind:value={newTitle}
          placeholder="Note title, Enter to create"
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
          <li class="side-empty">No notes yet</li>
        {/if}
      </ul>
    </section>

    <section class="side-section">
      <div class="side-title">Journal</div>
      <ul>
        {#each journalDays as day}
          <li>
            <button
              class="side-item"
              class:active={$currentPath === `journal/${day}.md`}
              onclick={() => onopen(`journal/${day}.md`)}
            >
              {day === today ? `Today — ${day}` : day}
            </button>
          </li>
        {/each}
      </ul>
    </section>

    <section class="side-section">
      <div class="side-title">Ideas</div>
      <ul>
        <li>
          <button class="side-item" class:active={$currentPath === 'ideas'} onclick={() => onopen('ideas')}>
            Idea stream
          </button>
        </li>
      </ul>
    </section>
  </nav>

  <div class="side-foot">
    <button class="foot-btn" onclick={() => theme.update((t) => (t === 'dark' ? 'light' : 'dark'))}>
      {$theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
    <button class="foot-btn" title="Your folder already IS the backup — this is just extra paranoia" onclick={onexport}>
      Export all as JSON
    </button>
    <p class="side-hint">Your folder is the data. Plain Markdown, no lock-in.</p>
  </div>
</aside>

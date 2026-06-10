<script lang="ts">
  import { brainIndex, paletteOpen, showToast } from '../stores'
  import { focusOnMount } from '../actions'
  import { fuzzyScore } from './fuzzy'
  import type { Snippet } from './snippets'

  let query = $state('')
  let selected = $state(0)
  let listEl: HTMLElement | null = $state(null)

  const pinned = $derived($brainIndex?.snippets ?? [])

  function scoreOf(q: string, s: Snippet): number {
    const label = s.label ? fuzzyScore(q, s.label) : -1
    const title = fuzzyScore(q, s.title)
    const code = fuzzyScore(q, s.code)
    // Label matches dominate, then title, then raw content.
    return Math.max(label >= 0 ? label * 3 + 10 : -1, title >= 0 ? title * 2 : -1, code)
  }

  const results = $derived.by(() => {
    const q = query.trim()
    if (!q) return pinned.slice(0, 50)
    return pinned
      .map((s) => ({ s, score: scoreOf(q, s) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r) => r.s)
  })

  $effect(() => {
    query
    selected = 0
  })

  $effect(() => {
    selected
    listEl?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  })

  async function choose(snippet: Snippet) {
    try {
      await navigator.clipboard.writeText(snippet.code)
      showToast('Snippet copied')
    } catch {
      showToast('Could not copy')
    }
    paletteOpen.set(false)
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      paletteOpen.set(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      selected = Math.min(selected + 1, results.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selected = Math.max(selected - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[selected]) choose(results[selected])
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
<div class="palette-overlay" onclick={() => paletteOpen.set(false)}>
  <div class="palette" onclick={(e) => e.stopPropagation()}>
    <input
      class="palette-input"
      use:focusOnMount
      bind:value={query}
      placeholder="Search pinned snippets…"
      onkeydown={onKeydown}
    />
    <ul class="palette-results" bind:this={listEl}>
      {#each results as snippet, i}
        <li
          class="palette-item"
          class:selected={i === selected}
          onclick={() => choose(snippet)}
          onmousemove={() => (selected = i)}
        >
          <div class="palette-row">
            <span class="snip-label">{snippet.label || '(unlabeled)'}</span>
            <span class="snip-meta">{snippet.language || 'code'} · {snippet.title}</span>
          </div>
          <div class="snip-preview">{snippet.code.split('\n')[0].slice(0, 90)}</div>
        </li>
      {/each}
      {#if results.length === 0}
        <li class="palette-empty">
          {pinned.length === 0 ? 'No pinned snippets yet — pin a code block with ☆' : 'No match'}
        </li>
      {/if}
    </ul>
  </div>
</div>

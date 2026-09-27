<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { slide } from 'svelte/transition'
  import { t } from '../i18n'
  import { autosize, fit } from '../actions'
  import { showMenu } from '../menu'
  import { FORMATS, toggleMarkerInText, renderInlineMarkdown } from '../format'
  import type { Block } from '../parser/parser'

  let {
    block,
    onedit,
    onremove,
    onnavigate,
    autostart = false
  }: {
    block: Extract<Block, { type: 'todo' }>
    onedit: () => void
    /** Called when the last item is deleted: the whole block goes away. */
    onremove: () => void
    /** A [[wiki-link]] in an item was clicked: open that note. */
    onnavigate: (name: string) => void
    /** A block just inserted from the menu mounts ready for typing. */
    autostart?: boolean
  } = $props()

  let listEl: HTMLElement

  onMount(() => {
    if (autostart) void focusItem(0)
  })

  // Only the item being edited is a textarea (raw markdown); the others
  // show their formatting rendered, like the note editor does.
  let focusedIdx = $state<number | null>(null)

  // ---------- Completed items fold away ----------
  // Every done item, wherever it sits in the list, goes into ONE
  // "N completed" group at the top of the block (a view only: the file order
  // is untouched). A freshly checked item lingers in place for a moment —
  // feedback and a chance to undo — then slides into the group. A done item
  // being edited while the group is closed stays where it is.

  const LINGER_MS = 1500
  const justDone = new SvelteSet<object>()
  let showDone = $state(false)

  type Row = { kind: 'item'; i: number } | { kind: 'done'; count: number }

  const rows = $derived.by(() => {
    const items = block.items
    const grouped = (i: number) =>
      items[i].done && !justDone.has(items[i]) && (showDone || focusedIdx !== i)
    const done: Row[] = []
    const open: Row[] = []
    items.forEach((_, i) => (grouped(i) ? done : open).push({ kind: 'item', i }))
    if (done.length === 0) return open
    return [{ kind: 'done', count: done.length } as Row, ...(showDone ? done : []), ...open]
  })

  function setDone(item: { done: boolean }, done: boolean) {
    item.done = done
    if (done) {
      justDone.add(item)
      setTimeout(() => justDone.delete(item), LINGER_MS)
    } else {
      justDone.delete(item)
    }
    onedit()
  }

  async function focusItem(i: number, caret?: number) {
    focusedIdx = i
    await tick()
    // One item at a time is a textarea, so this always finds the right one.
    const el = listEl.querySelector<HTMLTextAreaElement>('textarea.todo-text')
    if (el) {
      el.focus()
      const pos = Math.min(caret ?? el.value.length, el.value.length)
      el.setSelectionRange(pos, pos)
    }
  }

  /** Raw-text caret for a click on the rendered item: the spans carry the
   *  raw offset of their content in data-r. */
  function caretFromPoint(e: MouseEvent): number | undefined {
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY)
    if (!range) return undefined
    const node = range.startContainer
    const el = node instanceof Element ? node : node.parentElement
    const r = el?.closest<HTMLElement>('[data-r]')?.dataset.r
    return r == null ? undefined : Number(r) + range.startOffset
  }

  const wikiAt = (e: MouseEvent) => (e.target as HTMLElement).closest<HTMLElement>('.cm-wikilink[data-wiki]')

  function startEdit(e: MouseEvent, i: number) {
    if (e.button !== 0) return
    e.preventDefault()
    // A [[wiki-link]] navigates (on click, like in notes) instead of editing.
    if (wikiAt(e)) return
    void focusItem(i, caretFromPoint(e))
  }

  function onRenderClick(e: MouseEvent) {
    const link = wikiAt(e)
    if (link) onnavigate(link.dataset.wiki!)
  }

  function onBlur(e: FocusEvent) {
    // The formatting menu takes focus while it is open: stay in edit mode.
    if ((e.relatedTarget as HTMLElement | null)?.closest('.cm-image-menu')) return
    focusedIdx = null
  }

  async function onKeydown(e: KeyboardEvent, i: number) {
    const el = e.target as HTMLTextAreaElement
    if (e.key === 'Enter') {
      e.preventDefault()
      block.items.splice(i + 1, 0, { done: false, text: '' })
      onedit()
      await focusItem(i + 1)
    } else if (e.key === 'Escape') {
      el.blur()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && el.value === '') {
      // Emptied item + one more Backspace/Del = the item goes; the last
      // one takes the whole block with it (there is no other way out).
      e.preventDefault()
      block.items.splice(i, 1)
      if (block.items.length === 0) {
        onremove()
        return
      }
      onedit()
      await focusItem(Math.max(0, i - 1))
    }
  }

  // Same formatting menu as the notes; a right-click on a rendered item
  // first switches it to edit mode with the caret under the click.
  function onContextMenu(e: MouseEvent, i: number) {
    e.preventDefault()
    const items = FORMATS.map(([key, marker]) => ({
      label: $t(key),
      run: () => {
        const el = listEl.querySelector<HTMLTextAreaElement>('textarea.todo-text')
        if (!el) return
        const r = toggleMarkerInText(el.value, el.selectionStart, el.selectionEnd, marker)
        if (!r) return
        el.value = r.value
        block.items[i].text = r.value
        el.focus()
        el.setSelectionRange(r.start, r.end)
        autosize(el)
        onedit()
      }
    }))
    if (focusedIdx === i) {
      showMenu(e.clientX, e.clientY, items)
    } else {
      const caret = caretFromPoint(e)
      void focusItem(i, caret).then(() => showMenu(e.clientX, e.clientY, items))
    }
  }
</script>

<div class="todo-block" bind:this={listEl}>
  <!-- Keyed: items moving in and out of the group must not hand one item's
       checkbox (with its user-toggled DOM state) to its neighbour. -->
  {#each rows as row (row.kind === 'item' ? block.items[row.i] : 'fold')}
    {#if row.kind === 'done'}
      <button class="todo-fold" class:open={showDone} onclick={() => (showDone = !showDone)}>
        <svg class="todo-fold-chev" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {$t('todo.doneCount').replace('{n}', String(row.count))}
      </button>
    {:else}
      {@const i = row.i}
      {@const item = block.items[i]}
      <div class="todo-item" transition:slide={{ duration: 140 }}>
        <input
          type="checkbox"
          checked={item.done}
          onchange={(e) => setDone(item, (e.currentTarget as HTMLInputElement).checked)}
        />
        {#if focusedIdx === i}
          <textarea
            class="todo-text"
            class:done={item.done}
            rows="1"
            value={item.text}
            placeholder={$t('todo.ph')}
            use:fit
            oninput={(e) => {
              const el = e.target as HTMLTextAreaElement
              // One markdown line per item: pasted newlines become spaces.
              if (el.value.includes('\n')) el.value = el.value.replace(/\n+/g, ' ')
              item.text = el.value
              autosize(el)
              onedit()
            }}
            onkeydown={(e) => onKeydown(e, i)}
            oncontextmenu={(e) => onContextMenu(e, i)}
            onblur={onBlur}
          ></textarea>
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="todo-text todo-render"
            class:done={item.done}
            onmousedown={(e) => startEdit(e, i)}
            onclick={onRenderClick}
            oncontextmenu={(e) => onContextMenu(e, i)}
          >
            {#if item.text}
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html renderInlineMarkdown(item.text)}
            {:else}
              <span class="todo-ph">{$t('todo.ph')}</span>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/each}
</div>

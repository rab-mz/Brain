<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { t } from '../i18n'
  import { autosize, fit } from '../actions'
  import { showMenu } from '../menu'
  import { FORMATS, toggleMarkerInText, renderInlineMarkdown } from '../format'
  import type { Block } from '../parser/parser'

  let {
    block,
    onedit,
    onremove,
    autostart = false
  }: {
    block: Extract<Block, { type: 'todo' }>
    onedit: () => void
    /** Called when the last item is deleted: the whole block goes away. */
    onremove: () => void
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

  function startEdit(e: MouseEvent, i: number) {
    if (e.button !== 0) return
    e.preventDefault()
    void focusItem(i, caretFromPoint(e))
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
  {#each block.items as item, i}
    <div class="todo-item">
      <input
        type="checkbox"
        checked={item.done}
        onchange={() => {
          item.done = !item.done
          onedit()
        }}
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
        <div
          class="todo-text todo-render"
          class:done={item.done}
          onmousedown={(e) => startEdit(e, i)}
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
  {/each}
</div>

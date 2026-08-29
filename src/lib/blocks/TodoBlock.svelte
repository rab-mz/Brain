<script lang="ts">
  import { tick } from 'svelte'
  import { t } from '../i18n'
  import { autosize, fit } from '../actions'
  import { showMenu } from '../menu'
  import { FORMATS, toggleMarkerInText } from '../format'
  import type { Block } from '../parser/parser'

  let {
    block,
    onedit,
    onremove
  }: {
    block: Extract<Block, { type: 'todo' }>
    onedit: () => void
    /** Called when the last item is deleted: the whole block goes away. */
    onremove: () => void
  } = $props()

  let listEl: HTMLElement

  function focusItem(i: number) {
    const inputs = listEl.querySelectorAll<HTMLTextAreaElement>('.todo-text')
    const el = inputs[i]
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }

  async function onKeydown(e: KeyboardEvent, i: number) {
    const el = e.target as HTMLTextAreaElement
    if (e.key === 'Enter') {
      e.preventDefault()
      block.items.splice(i + 1, 0, { done: false, text: '' })
      onedit()
      await tick()
      focusItem(i + 1)
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
      await tick()
      focusItem(Math.max(0, i - 1))
    }
  }

  // Same formatting menu as the notes. The markers stay visible here (todo
  // text is plain), but the markdown itself is identical.
  function onContextMenu(e: MouseEvent, i: number) {
    e.preventDefault()
    const el = e.currentTarget as HTMLTextAreaElement
    showMenu(
      e.clientX,
      e.clientY,
      FORMATS.map(([key, marker]) => ({
        label: $t(key),
        run: () => {
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
    )
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
      ></textarea>
    </div>
  {/each}
</div>

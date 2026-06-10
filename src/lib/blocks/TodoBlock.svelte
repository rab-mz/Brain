<script lang="ts">
  import { tick } from 'svelte'
  import type { Block } from '../parser/parser'

  let { block, onedit }: { block: Extract<Block, { type: 'todo' }>; onedit: () => void } = $props()

  let listEl: HTMLElement

  function focusItem(i: number) {
    const inputs = listEl.querySelectorAll<HTMLInputElement>('.todo-text')
    inputs[i]?.focus()
  }

  async function onKeydown(e: KeyboardEvent, i: number) {
    if (e.key === 'Enter') {
      e.preventDefault()
      block.items.splice(i + 1, 0, { done: false, text: '' })
      onedit()
      await tick()
      focusItem(i + 1)
    } else if (e.key === 'Backspace' && (e.target as HTMLInputElement).value === '' && block.items.length > 1) {
      e.preventDefault()
      block.items.splice(i, 1)
      onedit()
      await tick()
      focusItem(Math.max(0, i - 1))
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
      <input
        class="todo-text"
        class:done={item.done}
        type="text"
        value={item.text}
        placeholder="To do…"
        oninput={(e) => {
          item.text = (e.target as HTMLInputElement).value
          onedit()
        }}
        onkeydown={(e) => onKeydown(e, i)}
      />
    </div>
  {/each}
</div>

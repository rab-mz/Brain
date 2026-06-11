<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Block } from '../parser/parser'
  import type { NoteEditor } from './editor'

  let {
    block,
    grow = false,
    onedit,
    onready,
    onactive
  }: {
    block: Extract<Block, { type: 'note' }>
    grow?: boolean
    onedit: () => void
    onready: (block: object, api: NoteEditor) => void
    onactive: (block: object) => void
  } = $props()

  let host: HTMLElement | null = $state(null)
  let api: NoteEditor | null = $state(null)
  // A click that lands before CodeMirror finished loading is replayed as
  // soon as the editor exists, so the first click always places the caret.
  let pendingFocus: { x: number; y: number } | null = null

  // The markdown editor (CodeMirror) is loaded lazily; the raw text is
  // visible immediately via the fallback <pre>.
  $effect(() => {
    if (!host || api) return
    let disposed = false
    const target = host
    import('./editor').then(async (mod) => {
      const created = await mod.createNoteEditor(target, {
        text: block.text,
        onChange: (text) => {
          block.text = text
          onedit()
        },
        onFocus: () => onactive(block)
      })
      if (disposed) {
        created.destroy()
        return
      }
      api = created
      onready(block, created)
      if (pendingFocus) {
        created.focusAt(pendingFocus.x, pendingFocus.y)
        pendingFocus = null
      }
    })
    return () => {
      disposed = true
    }
  })

  onDestroy(() => api?.destroy())

  // Distinguish clicks from selection drags: releasing the mouse outside
  // the text after dragging fires a click too, and placing the caret then
  // would collapse the selection the user just made.
  let downPos: { x: number; y: number } | null = null
  function onPointerDown(e: PointerEvent) {
    downPos = { x: e.clientX, y: e.clientY }
  }
  function wasDrag(e: MouseEvent): boolean {
    return downPos != null && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6
  }

  // Clicks on the wrapper's dead space (padding, area beside short lines)
  // still place the caret at the nearest position.
  function onClick(e: MouseEvent) {
    if (wasDrag(e)) return
    if ((e.target as HTMLElement).closest('.cm-content')) return
    if (api) {
      api.focusAt(e.clientX, e.clientY)
    } else {
      pendingFocus = { x: e.clientX, y: e.clientY }
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="note-wrap" class:grow onpointerdown={onPointerDown} onclick={onClick}>
  <div class="note-host" bind:this={host}>
    {#if !api}
      <pre class="note-fallback">{block.text}</pre>
    {/if}
  </div>
</div>

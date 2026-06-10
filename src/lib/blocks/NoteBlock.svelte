<script lang="ts">
  import { onDestroy } from 'svelte'
  import { t } from '../i18n'
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

  // The markdown editor (CodeMirror) is loaded lazily; the raw text is
  // visible immediately via the fallback <pre>.
  $effect(() => {
    if (!host || api) return
    let disposed = false
    const target = host
    const ph = $t('note.ph')
    import('./editor').then(async (mod) => {
      const created = await mod.createNoteEditor(target, {
        text: block.text,
        placeholder: ph,
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
    })
    return () => {
      disposed = true
    }
  })

  onDestroy(() => api?.destroy())
</script>

<div class="note-wrap" class:grow>
  <div class="note-host" bind:this={host}>
    {#if !api}
      <pre class="note-fallback">{block.text}</pre>
    {/if}
  </div>
</div>

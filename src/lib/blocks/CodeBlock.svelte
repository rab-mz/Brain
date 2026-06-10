<script lang="ts">
  import { onDestroy } from 'svelte'
  import { theme, showToast } from '../stores'
  import type { Block } from '../parser/parser'
  import type { BrainEditor } from './editor'

  let { block, onedit }: { block: Extract<Block, { type: 'code' }>; onedit: () => void } = $props()

  let host: HTMLElement | null = $state(null)
  let editor: BrainEditor | null = $state(null)

  // CodeMirror is loaded lazily the first time a code block renders.
  $effect(() => {
    if (!host || editor) return
    let disposed = false
    const target = host
    import('./editor').then(async (mod) => {
      const created = await mod.createEditor(target, {
        code: block.code,
        language: block.language,
        dark: document.documentElement.dataset.theme !== 'light',
        onChange: (code) => {
          block.code = code
          onedit()
        }
      })
      if (disposed) {
        created.destroy()
        return
      }
      editor = created
    })
    return () => {
      disposed = true
    }
  })

  $effect(() => {
    editor?.setDark($theme === 'dark')
  })

  onDestroy(() => editor?.destroy())

  async function copy() {
    try {
      await navigator.clipboard.writeText(block.code)
      showToast('Copied to clipboard')
    } catch {
      showToast('Could not copy')
    }
  }
</script>

<div class="code-block">
  <div class="code-head">
    {#if block.language === 'sql'}
      <input
        class="code-label"
        type="text"
        value={block.label}
        placeholder="Label this query…"
        oninput={(e) => {
          block.label = (e.target as HTMLInputElement).value
          onedit()
        }}
      />
      <span class="code-lang-tag">sql</span>
    {:else}
      <input
        class="code-lang"
        type="text"
        value={block.language}
        placeholder="lang"
        oninput={(e) => {
          block.language = (e.target as HTMLInputElement).value
          onedit()
        }}
      />
    {/if}
    <button
      class="icon-btn pin"
      class:pinned={block.pinned}
      title={block.pinned ? 'Unpin from palette' : 'Pin to palette (Cmd/Ctrl+K)'}
      onclick={() => {
        block.pinned = !block.pinned
        onedit()
      }}
    >
      {block.pinned ? '★' : '☆'}
    </button>
    <button class="icon-btn" title="Copy code" onclick={copy}>Copy</button>
  </div>
  <div class="code-host" bind:this={host}>
    {#if !editor}
      <pre class="code-fallback">{block.code}</pre>
    {/if}
  </div>
</div>

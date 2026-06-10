<script lang="ts">
  import { onDestroy } from 'svelte'
  import { theme, isDarkTheme, showToast } from '../stores'
  import { t } from '../i18n'
  import type { Block } from '../parser/parser'
  import type { BrainEditor } from './editor'

  let { block, onedit }: { block: Extract<Block, { type: 'code' }>; onedit: () => void } = $props()

  let host: HTMLElement | null = $state(null)
  let editor: BrainEditor | null = $state(null)

  const dark = $derived(isDarkTheme($theme))

  // CodeMirror is loaded lazily the first time a code block renders.
  $effect(() => {
    if (!host || editor) return
    let disposed = false
    const target = host
    import('./editor').then(async (mod) => {
      const docTheme = document.documentElement.dataset.theme ?? 'dark'
      const created = await mod.createEditor(target, {
        code: block.code,
        language: block.language,
        dark: docTheme === 'dark' || docTheme === 'ocean',
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
    editor?.setDark(dark)
  })

  onDestroy(() => editor?.destroy())

  async function copy() {
    try {
      await navigator.clipboard.writeText(block.code)
      showToast($t('toast.copied'))
    } catch {
      showToast($t('toast.copyFail'))
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
        placeholder={$t('code.labelPh')}
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
        placeholder={$t('code.langPh')}
        oninput={(e) => {
          block.language = (e.target as HTMLInputElement).value
          onedit()
        }}
      />
    {/if}
    <button
      class="icon-btn pin"
      class:pinned={block.pinned}
      title={block.pinned ? $t('code.unpin') : $t('code.pin')}
      onclick={() => {
        block.pinned = !block.pinned
        onedit()
      }}
    >
      {block.pinned ? '★' : '☆'}
    </button>
    <button class="icon-btn" title={$t('code.copy')} onclick={copy}>{$t('code.copyBtn')}</button>
  </div>
  <div class="code-host" bind:this={host}>
    {#if !editor}
      <pre class="code-fallback">{block.code}</pre>
    {/if}
  </div>
</div>

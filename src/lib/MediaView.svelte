<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { readFileBlob, findReferences } from './fs/files'
  import { kindOfName, mimeOf, KIND_COLORS, KIND_ICONS } from './filetypes'
  import { fileTitles } from './stores'
  import { t } from './i18n'

  // One file of a notes/ folder (an image in assets/, a PDF…): preview, the
  // notes that use it, and a real delete from disk (the in-note "Remove
  // from note" only drops the text).
  let {
    root,
    path,
    notes,
    onopennote,
    ondelete
  }: {
    root: FileSystemDirectoryHandle
    path: string
    /** Every note path, to look for the ones embedding this file. */
    notes: string[]
    onopennote: (path: string) => void
    ondelete: () => void
  } = $props()

  const name = $derived(path.split('/').pop()!)
  const where = $derived(path.split('/').slice(1, -1).join(' / '))
  const kind = $derived(kindOfName(name))

  let url: string | null = $state(null)
  let size = $state('')
  let refs: string[] | null = $state(null)

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  function noteTitle(p: string): string {
    return $fileTitles[p] || p.split('/').pop()!.replace(/\.md$/, '')
  }

  onMount(async () => {
    const blob = await readFileBlob(root, path)
    if (blob) {
      size = formatSize(blob.size)
      // PDFs need their MIME on the blob to render in the iframe.
      const typed = kind === 'pdf' ? new Blob([blob], { type: mimeOf(name) }) : blob
      url = URL.createObjectURL(typed)
    }
    refs = await findReferences(root, notes, path)
  })

  onDestroy(() => {
    if (url) URL.revokeObjectURL(url)
  })

  function download() {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
  }
</script>

<div class="media-view">
  <div class="media-head">
    <div>
      <h1 class="media-title">{name}</h1>
      <div class="media-where">{where}{size ? `, ${size}` : ''}</div>
    </div>
    <div class="media-actions">
      <button class="media-btn" onclick={download} disabled={!url}>{$t('media.download')}</button>
      <button class="media-btn danger" onclick={ondelete}>{$t('media.deleteFile')}</button>
    </div>
  </div>

  <div class="media-preview">
    {#if url && kind === 'image'}
      <img src={url} alt={name} />
    {:else if url && kind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={url} controls preload="metadata"></video>
    {:else if url && kind === 'audio'}
      <audio src={url} controls preload="metadata"></audio>
    {:else if url && kind === 'pdf'}
      <iframe src={url} title={name}></iframe>
    {:else}
      <div class="media-none">
        <span class="file-icon" style="color: {kind ? KIND_COLORS[kind] : 'var(--muted)'}">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- static SVG from filetypes.ts -->
          {@html KIND_ICONS[kind ?? 'text']}
        </span>
        {$t('media.noPreview')}
      </div>
    {/if}
  </div>

  <section class="media-refs">
    <h3>{$t('media.usedIn')}</h3>
    {#if refs === null}
      <p>{$t('media.searching')}</p>
    {:else if refs.length === 0}
      <p>{$t('media.unused')}</p>
    {:else}
      <ul>
        {#each refs as ref (ref)}
          <li><button onclick={() => onopennote(ref)}>{noteTitle(ref)}</button></li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

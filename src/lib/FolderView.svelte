<script lang="ts">
  import { onMount } from 'svelte'
  import { listMarkdown, listNotesTree, fileExists } from './fs/files'
  import { t } from './i18n'

  let {
    root,
    onchangefolder
  }: {
    root: FileSystemDirectoryHandle
    onchangefolder: () => void
  } = $props()

  let permission: PermissionState = $state('prompt')
  let listing: Array<{ folder: string; files: string[] }> = $state([])
  let hasIndex = $state(false)

  onMount(async () => {
    try {
      permission = await root.queryPermission({ mode: 'readwrite' })
    } catch {
      // Leave 'prompt'.
    }
    const out: Array<{ folder: string; files: string[] }> = []
    const tree = await listNotesTree(root)
    out.push({
      folder: 'notes',
      files: [...tree.files.sort(), ...tree.folders.flatMap((f) => f.files.sort().map((n) => `${f.name}/${n}`))]
    })
    for (const folder of ['journal', 'ideas']) {
      out.push({ folder, files: (await listMarkdown(root, folder)).sort() })
    }
    listing = out
    hasIndex = await fileExists(root, '.brain/index.json')
  })
</script>

<div class="folder-view">
  <h1 class="doc-title">{$t('folder.title')}</h1>

  <div class="folder-card">
    <div class="folder-row">
      <span class="folder-key">{$t('folder.connected')}</span>
      <span class="folder-name">📁 {root.name}</span>
    </div>
    <div class="folder-row">
      <span class="folder-key">{$t('folder.permission')}</span>
      <span class="folder-perm" class:ok={permission === 'granted'}>
        {permission === 'granted' ? `✓ ${$t('folder.granted')}` : $t('folder.prompt')}
      </span>
    </div>
    <button class="primary folder-change" onclick={onchangefolder}>{$t('folder.change')}</button>
    <p class="folder-note">{$t('folder.note')}</p>
  </div>

  <p class="folder-live">{$t('folder.live')}</p>
  <div class="folder-tree">
    {#each listing as entry}
      <div class="tree-folder">{entry.folder}/ <span class="tree-count">({entry.files.length})</span></div>
      {#each entry.files as file}
        <div class="tree-file">{file}</div>
      {/each}
      {#if entry.files.length === 0}
        <div class="tree-file tree-empty">({$t('folder.empty')})</div>
      {/if}
    {/each}
    <div class="tree-folder">.brain/</div>
    {#if hasIndex}
      <div class="tree-file">index.json <span class="tree-count">— {$t('folder.indexNote')}</span></div>
    {/if}
  </div>
</div>

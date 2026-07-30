<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { listMarkdown, listNotesTree, fileExists } from './fs/files'
  import { t } from './i18n'
  import FolderIcon from './FolderIcon.svelte'

  let {
    root,
    onchangefolder,
    onrenamefolder
  }: {
    root: FileSystemDirectoryHandle
    onchangefolder: () => void
    onrenamefolder: (oldName: string, newName: string) => Promise<void>
  } = $props()

  let permission: PermissionState = $state('prompt')
  let listing: Array<{ folder: string; files: string[] }> = $state([])
  let folders: string[] = $state([])
  let hasIndex = $state(false)

  let editing: string | null = $state(null)
  let editValue = $state('')
  let editInput: HTMLInputElement | null = $state(null)

  async function load() {
    const out: Array<{ folder: string; files: string[] }> = []
    const tree = await listNotesTree(root)
    folders = tree.folders.map((f) => f.name)
    out.push({
      folder: 'notes',
      files: [...tree.files.sort(), ...tree.folders.flatMap((f) => f.files.sort().map((n) => `${f.name}/${n}`))]
    })
    for (const folder of ['journal', 'ideas']) {
      out.push({ folder, files: (await listMarkdown(root, folder)).sort() })
    }
    listing = out
    hasIndex = await fileExists(root, '.brain/index.json')
  }

  onMount(async () => {
    try {
      permission = await root.queryPermission({ mode: 'readwrite' })
    } catch {
      // Leave 'prompt'.
    }
    await load()
  })

  async function startEdit(name: string) {
    editing = name
    editValue = name
    await tick()
    editInput?.focus()
    editInput?.select()
  }

  async function confirmEdit() {
    const from = editing
    const to = editValue.trim()
    editing = null
    if (!from || !to || to === from) return
    await onrenamefolder(from, to)
    await load()
  }

  function onEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') void confirmEdit()
    if (e.key === 'Escape') editing = null
  }
</script>

<div class="folder-view">
  <h1 class="doc-title">{$t('folder.title')}</h1>

  <div class="folder-card">
    <div class="folder-row">
      <span class="folder-key">{$t('folder.connected')}</span>
      <span class="folder-name"><FolderIcon /> {root.name}</span>
    </div>
    <div class="folder-row">
      <span class="folder-key">{$t('folder.permission')}</span>
      <span class="folder-perm" class:ok={permission === 'granted'}>
        {permission === 'granted' ? `✓ ${$t('folder.granted')}` : $t('folder.prompt')}
      </span>
    </div>
    <button class="primary folder-change" onclick={onchangefolder}>{$t('folder.change')}</button>
    <p class="folder-note">{$t('folder.note')}</p>
    <p class="folder-note">{$t('folder.rootRename')}</p>
  </div>

  <div class="folder-card">
    <div class="folder-row">
      <span class="folder-key">{$t('folder.subfolders')}</span>
    </div>
    {#each folders as name (name)}
      <div class="folder-sub-row">
        {#if editing === name}
          <FolderIcon />
          <input
            class="folder-rename-input"
            bind:this={editInput}
            bind:value={editValue}
            onkeydown={onEditKeydown}
            onblur={confirmEdit}
          />
        {:else}
          <span class="folder-name"><FolderIcon /> {name}</span>
          <button class="folder-rename-btn" data-tip={$t('folder.renameTip')} onclick={() => startEdit(name)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M11.1 2.4a1.6 1.6 0 0 1 2.3 2.3L5.7 12.4 2.5 13.3l.9-3.2z" />
              <path d="M9.8 3.7l2.3 2.3" />
            </svg>
          </button>
        {/if}
      </div>
    {/each}
    {#if folders.length === 0}
      <p class="folder-note">{$t('folder.noSubfolders')}</p>
    {/if}
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

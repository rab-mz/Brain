<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { parseDocument, serializeDocument, type BrainDoc, type Block } from './parser/parser'
  import { readFile, writeFile } from './fs/files'
  import TodoBlock from './blocks/TodoBlock.svelte'
  import CodeBlock from './blocks/CodeBlock.svelte'
  import NoteBlock from './blocks/NoteBlock.svelte'
  import InsertPoint from './blocks/InsertPoint.svelte'

  let {
    root,
    path,
    onsaved
  }: {
    root: FileSystemDirectoryHandle
    path: string
    onsaved: (path: string, doc: BrainDoc) => void
  } = $props()

  let doc: BrainDoc | null = $state(null)
  let docEl: HTMLElement | null = $state(null)
  let lastFileContent = ''
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // Stable identities for keyed {#each} so CodeMirror instances survive
  // inserts/removals of sibling blocks.
  const blockIds = new WeakMap<object, number>()
  let nextBlockId = 1
  function idOf(block: object): number {
    let id = blockIds.get(block)
    if (!id) {
      id = nextBlockId++
      blockIds.set(block, id)
    }
    return id
  }

  const title = $derived(
    doc?.frontmatter.title ?? path.split('/').pop()!.replace(/\.md$/, '')
  )

  onMount(async () => {
    const text = await readFile(root, path)
    if (text == null) return
    lastFileContent = text
    doc = parseDocument(text)
    await tick()
    restoreCursor()
  })

  // Files are the source of truth: pick up external edits on window focus.
  async function onWindowFocus() {
    if (saveTimer) return
    const text = await readFile(root, path)
    if (text != null && text !== lastFileContent && !saveTimer) {
      lastFileContent = text
      doc = parseDocument(text)
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 300)
  }

  async function saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!doc) return
    let snapshot = $state.snapshot(doc) as BrainDoc
    if (serializeDocument(snapshot) === lastFileContent) return
    doc.frontmatter.updated = new Date().toISOString()
    snapshot = $state.snapshot(doc) as BrainDoc
    const markdown = serializeDocument(snapshot)
    await writeFile(root, path, markdown)
    lastFileContent = markdown
    onsaved(path, snapshot)
  }

  onDestroy(() => {
    if (saveTimer) void saveNow()
  })

  function insertBlock(index: number, kind: 'note' | 'todo' | 'code' | 'sql') {
    if (!doc) return
    const block: Block =
      kind === 'note'
        ? { type: 'note', text: '' }
        : kind === 'todo'
          ? { type: 'todo', items: [{ done: false, text: '' }] }
          : { type: 'code', language: kind === 'sql' ? 'sql' : '', code: '', label: '', pinned: false }
    doc.blocks.splice(index, 0, block)
    scheduleSave()
  }

  function removeBlock(index: number) {
    doc?.blocks.splice(index, 1)
    scheduleSave()
  }

  function rememberCursor(index: number) {
    try {
      localStorage.setItem('brain:cursor', JSON.stringify({ path, block: index }))
    } catch {
      // Ignore: resume position just won't persist.
    }
  }

  function restoreCursor() {
    try {
      const raw = localStorage.getItem('brain:cursor')
      if (!raw) return
      const saved = JSON.parse(raw) as { path: string; block: number }
      if (saved.path !== path) return
      const el = docEl?.querySelector(`[data-block-index="${saved.block}"]`)
      el?.scrollIntoView({ block: 'center' })
    } catch {
      // Ignore corrupt state.
    }
  }
</script>

<svelte:window onfocus={onWindowFocus} />

{#if doc}
  <article class="doc" bind:this={docEl}>
    <h1 class="doc-title">{title}</h1>
    {#each doc.blocks as block, i (idOf(block))}
      <InsertPoint oninsert={(kind) => insertBlock(i, kind)} />
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="block" data-block-index={i} onfocusin={() => rememberCursor(i)}>
        {#if block.type === 'todo'}
          <TodoBlock {block} onedit={scheduleSave} />
        {:else if block.type === 'code'}
          <CodeBlock {block} onedit={scheduleSave} />
        {:else}
          <NoteBlock {block} onedit={scheduleSave} />
        {/if}
        <button class="block-delete" title="Delete block" onclick={() => removeBlock(i)}>×</button>
      </div>
    {/each}
    <InsertPoint always oninsert={(kind) => insertBlock(doc!.blocks.length, kind)} />
  </article>
{/if}

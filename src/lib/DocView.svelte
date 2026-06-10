<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { parseDocument, serializeDocument, type BrainDoc, type Block } from './parser/parser'
  import { readFile, writeFile } from './fs/files'
  import { sidebarCollapsed } from './stores'
  import { t, lang, formatDayFull } from './i18n'
  import TodoBlock from './blocks/TodoBlock.svelte'
  import CodeBlock from './blocks/CodeBlock.svelte'
  import NoteBlock from './blocks/NoteBlock.svelte'
  import type { NoteEditor } from './blocks/editor'

  let {
    root,
    path,
    onsaved,
    onrequestdelete
  }: {
    root: FileSystemDirectoryHandle
    path: string
    onsaved: (path: string, doc: BrainDoc) => void
    onrequestdelete: () => void
  } = $props()

  let doc: BrainDoc | null = $state(null)
  let docEl: HTMLElement | null = $state(null)
  let plusOpen = $state(false)
  let lastFileContent = ''
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const isJournal = path.startsWith('journal/')
  const journalDay = isJournal ? path.split('/')[1].replace(/\.md$/, '') : ''
  const baseName = path.split('/').pop()!.replace(/\.md$/, '')

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

  // Note editors register themselves so the floating "+" can split the
  // focused note at the cursor, and background clicks can focus the page.
  const noteApis = new WeakMap<object, NoteEditor>()
  let lastActiveNote: object | null = null
  function onNoteReady(block: object, api: NoteEditor) {
    noteApis.set(block, api)
  }
  function onNoteActive(block: object) {
    lastActiveNote = block
  }

  /**
   * The document is rendered as one continuous note surface: empty padding
   * notes are kept at the start/end and between special blocks so there is
   * always somewhere to click and write, and adjacent notes are merged.
   */
  function normalizeBlocks(blocks: Block[]): Block[] {
    const merged: Block[] = []
    for (const b of blocks) {
      if (b.type === 'note') {
        if (b.text.trim() === '') continue
        const prev = merged[merged.length - 1]
        if (prev && prev.type === 'note') {
          merged[merged.length - 1] = { type: 'note', text: prev.text + '\n\n' + b.text }
          continue
        }
      }
      merged.push(b)
    }
    const out: Block[] = []
    for (const b of merged) {
      if (b.type !== 'note' && out[out.length - 1]?.type !== 'note') {
        out.push({ type: 'note', text: '' })
      }
      out.push(b)
    }
    if (out.length === 0 || out[out.length - 1].type !== 'note') {
      out.push({ type: 'note', text: '' })
    }
    return out
  }

  onMount(async () => {
    const text = await readFile(root, path)
    if (text == null) return
    lastFileContent = text
    const parsed = parseDocument(text)
    parsed.blocks = normalizeBlocks(parsed.blocks)
    doc = parsed
    await tick()
    restoreCursor()
  })

  // Files are the source of truth: pick up external edits on window focus.
  async function onWindowFocus() {
    if (saveTimer) return
    const text = await readFile(root, path)
    if (text != null && text !== lastFileContent && !saveTimer) {
      lastFileContent = text
      const parsed = parseDocument(text)
      parsed.blocks = normalizeBlocks(parsed.blocks)
      doc = parsed
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

  function makeSpecial(kind: 'todo' | 'sql' | 'code'): Block {
    if (kind === 'todo') return { type: 'todo', items: [{ done: false, text: '' }] }
    const language = kind === 'sql' ? 'sql' : ''
    return { type: 'code', language, code: '', label: '', pinned: false }
  }

  // Insert at the cursor of the focused note (splitting it), or at the end.
  function insertSpecial(kind: 'todo' | 'sql' | 'code') {
    if (!doc) return
    const special = makeSpecial(kind)
    const blocks = doc.blocks
    const idx = lastActiveNote ? blocks.indexOf(lastActiveNote as Block) : -1
    if (idx >= 0) {
      const note = blocks[idx] as Extract<Block, { type: 'note' }>
      const api = noteApis.get(lastActiveNote!)
      const offset = api ? api.getOffset() : note.text.length
      const before = note.text.slice(0, offset)
      const after = note.text.slice(offset)
      blocks.splice(idx, 1, { type: 'note', text: before }, special, { type: 'note', text: after })
    } else {
      blocks.push(special)
    }
    doc.blocks = normalizeBlocks(doc.blocks)
    lastActiveNote = null
    scheduleSave()
  }

  function removeBlock(block: Block) {
    if (!doc) return
    doc.blocks = normalizeBlocks(doc.blocks.filter((b) => b !== block))
    scheduleSave()
  }

  function onBackgroundClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.block, .doc-head, .float-plus')) return
    if (!doc) return
    const last = doc.blocks[doc.blocks.length - 1]
    if (last?.type === 'note') noteApis.get(last)?.focusEnd()
  }

  function onTitleInput(e: Event) {
    if (!doc) return
    doc.frontmatter.title = (e.target as HTMLInputElement).value
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
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <article class="doc-outer" bind:this={docEl} onclick={onBackgroundClick}>
    <div class="doc-inner">
      <div class="doc-head">
        {#if isJournal}
          <h1 class="doc-title">{formatDayFull(journalDay, $lang)}</h1>
        {:else}
          <input
            class="doc-title-input"
            value={doc.frontmatter.title ?? baseName}
            placeholder={$t('doc.titlePh')}
            oninput={onTitleInput}
          />
        {/if}
        <button class="doc-delete" title={$t('doc.deleteTooltip')} onclick={onrequestdelete}>🗑</button>
      </div>

      {#each doc.blocks as block, i (idOf(block))}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="block"
          class:block-special={block.type !== 'note'}
          data-block-index={i}
          onfocusin={() => rememberCursor(i)}
        >
          {#if block.type === 'todo'}
            <TodoBlock {block} onedit={scheduleSave} />
          {:else if block.type === 'code'}
            <CodeBlock {block} onedit={scheduleSave} />
          {:else}
            <NoteBlock
              {block}
              grow={i === doc.blocks.length - 1}
              onedit={scheduleSave}
              onready={onNoteReady}
              onactive={onNoteActive}
            />
          {/if}
          {#if block.type !== 'note'}
            <button class="block-delete" title={$t('block.remove')} onclick={() => removeBlock(block)}>×</button>
          {/if}
        </div>
      {/each}
    </div>
  </article>

  <div class="float-plus" style="left: {$sidebarCollapsed ? 20 : 272}px">
    {#if plusOpen}
      <div class="plus-menu">
        <button
          onclick={() => {
            plusOpen = false
            insertSpecial('todo')
          }}>{$t('insert.todo')}</button
        >
        <button
          onclick={() => {
            plusOpen = false
            insertSpecial('sql')
          }}>SQL</button
        >
        <button
          onclick={() => {
            plusOpen = false
            insertSpecial('code')
          }}>{$t('insert.code')}</button
        >
      </div>
    {/if}
    <button class="plus-btn" class:open={plusOpen} title={$t('insert.title')} onclick={() => (plusOpen = !plusOpen)}>
      +
    </button>
  </div>
{/if}

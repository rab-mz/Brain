<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { parseDocument, serializeDocument, type BrainDoc, type Block } from './parser/parser'
  import { readFile, writeFile, readFileBlob, fileExists, normalizePath, ASSETS_DIR } from './fs/files'
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
  let plusOpen = $state(false)
  let lastFileContent = ''
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const isJournal = path.startsWith('journal/')
  const journalDay = isJournal ? path.split('/')[1].replace(/\.md$/, '') : ''
  const baseName = path.split('/').pop()!.replace(/\.md$/, '')
  /** Directory of this document; image links are relative to it. */
  const docDir = path.split('/').slice(0, -1).join('/')

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
  let autofocusTarget: object | null = null
  function onNoteReady(block: object, api: NoteEditor) {
    noteApis.set(block, api)
    // The caret should be visible the moment a document opens.
    if (block === autofocusTarget) {
      autofocusTarget = null
      api.focusEnd()
    }
  }
  function onNoteActive(block: object) {
    lastActiveNote = block
  }

  /**
   * The document is one continuous note surface: adjacent notes merge and
   * empty ones are dropped, so consecutive snippets stack in a column.
   * Only a single trailing note is kept (it grows to fill the page), so
   * there is always somewhere to write at the end.
   */
  function normalizeBlocks(blocks: Block[]): Block[] {
    const out: Block[] = []
    for (const b of blocks) {
      if (b.type === 'note') {
        if (b.text.trim() === '') continue
        const prev = out[out.length - 1]
        if (prev && prev.type === 'note') {
          out[out.length - 1] = { type: 'note', text: prev.text + '\n\n' + b.text }
          continue
        }
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
    // Entering a document always selects the end of the last line, caret
    // blinking. Set the target BEFORE rendering so onNoteReady can never
    // race past it. IMPORTANT: read it through `doc` (the reactive proxy)
    // — child components receive proxied blocks, so comparing against the
    // raw parsed object would never match.
    const blocks = doc!.blocks
    autofocusTarget = blocks[blocks.length - 1]
    await tick()
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
    for (const url of imageUrls.values()) URL.revokeObjectURL(url)
  })

  // ---------- Images: relative paths on disk, blob URLs in the editor ----------

  const imageUrls = new Map<string, string>()

  async function resolveImage(src: string): Promise<string | null> {
    const imgPath = normalizePath(docDir + '/' + decodeURI(src))
    const cached = imageUrls.get(imgPath)
    if (cached) return cached
    const blob = await readFileBlob(root, imgPath)
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    imageUrls.set(imgPath, url)
    return url
  }

  function sanitizeImageName(name: string): string {
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'png'
    const base =
      name
        .slice(0, dot > 0 ? dot : undefined)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'image'
    return `${base}.${ext}`
  }

  /** Save a dropped image/video next to the document and return its relative link. */
  async function saveImage(file: File): Promise<string> {
    const clean = sanitizeImageName(file.name)
    const dot = clean.lastIndexOf('.')
    let name = clean
    let n = 2
    while (await fileExists(root, `${docDir}/${ASSETS_DIR}/${name}`)) {
      name = `${clean.slice(0, dot)}-${n++}${clean.slice(dot)}`
    }
    await writeFile(root, `${docDir}/${ASSETS_DIR}/${name}`, file)
    return `${ASSETS_DIR}/${name}`
  }

  let dragOver = $state(false)

  // Duplicated from blocks/editor.ts on purpose: importing a value from
  // there would pull CodeMirror into the initial bundle. During dragover
  // only the MIME type exists (no filename), so videos with an empty type
  // are only caught at drop time via the extension.
  const VIDEO_SRC_RE = /\.(mp4|mov|m4v|webm)$/i
  const isMediaType = (type: string) => type.startsWith('image/') || type.startsWith('video/')

  function hasMediaFiles(e: DragEvent): boolean {
    return [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && (isMediaType(i.type) || i.type === ''))
  }

  function onDragOver(e: DragEvent) {
    if (!hasMediaFiles(e)) return
    e.preventDefault()
    dragOver = true
  }

  async function onDrop(e: DragEvent) {
    dragOver = false
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isMediaType(f.type) || VIDEO_SRC_RE.test(f.name))
    if (files.length === 0 || !doc) return
    e.preventDefault()
    for (const file of files) {
      const rel = await saveImage(file)
      insertImageMarkdown(e.clientX, e.clientY, `![${file.name}](${rel})`)
    }
    scheduleSave()
  }

  /** Insert the image link in the note under the drop point (or the last one). */
  function insertImageMarkdown(x: number, y: number, md: string) {
    if (!doc) return
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.block[data-bid]')
    let target: Block | null = null
    if (el instanceof HTMLElement) {
      const bid = Number(el.dataset.bid)
      target = doc.blocks.find((b) => b.type === 'note' && idOf(b) === bid) ?? null
    }
    if (!target) {
      const last = doc.blocks[doc.blocks.length - 1]
      target = last?.type === 'note' ? last : null
    }
    if (!target) {
      doc.blocks.push({ type: 'note', text: md })
      return
    }
    const api = noteApis.get(target)
    if (api) {
      api.insertBlockAt(x, y, md)
    } else {
      const note = target as Extract<Block, { type: 'note' }>
      note.text = note.text === '' ? md : note.text + '\n\n' + md
    }
  }

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

  // Distinguish clicks from selection drags: a drag that ends on the page
  // background fires a click on the common ancestor, and focusing then
  // would collapse the selection the user just made.
  let pointerDownPos: { x: number; y: number } | null = null
  function onPointerDown(e: PointerEvent) {
    pointerDownPos = { x: e.clientX, y: e.clientY }
  }
  function wasDrag(e: MouseEvent): boolean {
    return (
      pointerDownPos != null && Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 6
    )
  }

  function onBackgroundClick(e: MouseEvent) {
    if (wasDrag(e)) return
    if ((e.target as HTMLElement).closest('.block, .doc-head, .float-plus')) return
    if (!doc) return
    const last = doc.blocks[doc.blocks.length - 1]
    if (last?.type === 'note') noteApis.get(last)?.focusAt(e.clientX, e.clientY)
  }

  function onTitleInput(e: Event) {
    if (!doc) return
    doc.frontmatter.title = (e.target as HTMLInputElement).value
    scheduleSave()
  }
</script>

<svelte:window onfocus={onWindowFocus} />

{#if doc}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <article
    class="doc-outer"
    class:drag-over={dragOver}
    onpointerdown={onPointerDown}
    onclick={onBackgroundClick}
    ondragover={onDragOver}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
  >
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
        <button class="doc-delete" data-tip={$t('doc.deleteTooltip')} onclick={onrequestdelete}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
          </svg>
        </button>
      </div>

      {#each doc.blocks as block, i (idOf(block))}
        <div class="block" class:block-special={block.type !== 'note'} data-bid={idOf(block)}>
          {#if block.type === 'todo'}
            <TodoBlock {block} onedit={scheduleSave} />
          {:else if block.type === 'code'}
            <CodeBlock {block} onedit={scheduleSave} />
          {:else}
            <NoteBlock
              {block}
              grow={i === doc.blocks.length - 1}
              resolveimage={resolveImage}
              saveimage={saveImage}
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

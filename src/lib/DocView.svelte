<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { parseDocument, serializeDocument, type BrainDoc, type Block } from './parser/parser'
  import { readFile, writeFile, readFileBlob, fileExists, normalizePath, ASSETS_DIR } from './fs/files'
  import { autosize, fit } from './actions'
  import { t, lang, formatDayFull } from './i18n'
  import TodoBlock from './blocks/TodoBlock.svelte'
  import CodeBlock from './blocks/CodeBlock.svelte'
  import NoteBlock from './blocks/NoteBlock.svelte'
  import type { NoteEditor } from './blocks/editor'

  let {
    root,
    path,
    onsaved,
    onrequestdelete,
    onnavigate
  }: {
    root: FileSystemDirectoryHandle
    path: string
    onsaved: (path: string, doc: BrainDoc) => void
    onrequestdelete: () => void
    /** A [[wiki-link]] in a note was clicked: open that note. */
    onnavigate: (name: string) => void
  } = $props()

  let doc: BrainDoc | null = $state(null)
  let titleInput: HTMLTextAreaElement | null = $state(null)
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
  function onNoteReady(block: object, api: NoteEditor) {
    noteApis.set(block, api)
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
    // Documents open reading from the top — no caret parked at the end
    // (it used to drag the scroll to the bottom of long notes). The only
    // exception: a note without a name yet (fresh "+" creation) opens on
    // the title input, so typing the name is the natural next gesture.
    if (!isJournal && !(parsed.frontmatter.title ?? '').trim()) {
      await tick()
      titleInput?.focus()
    }
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
      // An externally edited title can change how many lines it wraps to.
      await tick()
      if (titleInput) autosize(titleInput)
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

  /** Save a dropped image/video/file next to the document and return its relative link. */
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
  /** File kinds detected from the drag's MIME types, for the drop overlay.
   *  Empty while dragOver = only unknown types (no MIME): generic badge. */
  let dragKinds: DropKind[] = $state([])

  // Duplicated from blocks/editor.ts on purpose: importing a value from
  // there would pull CodeMirror into the initial bundle. During dragover
  // only the MIME type exists (no filename), so files with an empty type
  // (some .mov drags) are only caught at drop time via the extension.
  const MEDIA_EXT_RE = /\.(mp4|mov|m4v|webm|pdf|csv)$/i

  type DropKind = 'image' | 'video' | 'pdf' | 'csv'
  // Same hues as the .drop-* CSS classes; tints the page outline while dragging.
  const DROP_COLORS: Record<DropKind, string> = {
    image: '#3b82f6',
    video: '#8b5cf6',
    pdf: '#e5484d',
    csv: '#30a46c'
  }
  function kindOfType(type: string): DropKind | null {
    if (type.startsWith('image/')) return 'image'
    if (type.startsWith('video/')) return 'video'
    if (type === 'application/pdf') return 'pdf'
    // Windows often reports .csv as an Excel type.
    if (type === 'text/csv' || type === 'application/vnd.ms-excel') return 'csv'
    return null
  }
  const isMediaType = (type: string) => kindOfType(type) !== null

  // Set on drags that start from one of our own file cards (see
  // blocks/editor.ts, same duplication rationale as MEDIA_EXT_RE): dropping
  // those back on the page must not duplicate the card.
  const BRAIN_FILE_DRAG = 'application/x-brain-file'

  // A dragged card can be released anywhere in the app; cancel those drops
  // globally, or a textarea (the title, sidebar inputs) would insert stray
  // text through the browser's default drop action.
  function onWindowDropCapture(e: DragEvent) {
    if (e.dataTransfer?.types.includes(BRAIN_FILE_DRAG)) e.preventDefault()
  }
  onMount(() => {
    window.addEventListener('drop', onWindowDropCapture, true)
    return () => window.removeEventListener('drop', onWindowDropCapture, true)
  })

  function hasMediaFiles(e: DragEvent): boolean {
    if (e.dataTransfer?.types.includes(BRAIN_FILE_DRAG)) return false
    return [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && (isMediaType(i.type) || i.type === ''))
  }

  function onDragOver(e: DragEvent) {
    if (!hasMediaFiles(e)) return
    e.preventDefault()
    dragOver = true
    const kinds = [...(e.dataTransfer?.items ?? [])]
      .filter((i) => i.kind === 'file')
      .map((i) => kindOfType(i.type))
      .filter((k): k is DropKind => k !== null)
    dragKinds = [...new Set(kinds)]
  }

  async function onDrop(e: DragEvent) {
    dragOver = false
    if (e.dataTransfer?.types.includes(BRAIN_FILE_DRAG)) return
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isMediaType(f.type) || MEDIA_EXT_RE.test(f.name))
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
  async function insertSpecial(kind: 'todo' | 'sql' | 'code') {
    if (!doc) return
    const special = makeSpecial(kind)
    const blocks = doc.blocks
    const idx = lastActiveNote ? blocks.indexOf(lastActiveNote as Block) : -1
    let inserted: Block
    if (idx >= 0) {
      const note = blocks[idx] as Extract<Block, { type: 'note' }>
      const api = noteApis.get(lastActiveNote!)
      const offset = api ? api.getOffset() : note.text.length
      const before = note.text.slice(0, offset)
      const after = note.text.slice(offset)
      blocks.splice(idx, 1, { type: 'note', text: before }, special, { type: 'note', text: after })
      // Read the block back through the reactive array: the {#each} keys on
      // the proxy's identity, not on the raw object that went in.
      inserted = blocks[idx + 1]
    } else {
      blocks.push(special)
      inserted = blocks[blocks.length - 1]
    }
    doc.blocks = normalizeBlocks(doc.blocks)
    lastActiveNote = null
    scheduleSave()
    // A fresh todo is for typing into right now — it mounts in edit mode
    // with the caret ready (before this, the first keystrokes went
    // nowhere).
    if (kind === 'todo') freshTodo = inserted
  }

  /** The todo block just inserted from the menu: it autostarts editing. */
  let freshTodo: Block | null = $state(null)

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

  let articleEl: HTMLElement | null = $state(null)

  function onBackgroundClick(e: MouseEvent) {
    if (wasDrag(e)) return
    if ((e.target as HTMLElement).closest('.block, .doc-head')) return
    if (!doc || !articleEl) return
    // Route the click to the block at the same height (side-gutter clicks
    // land beside the column). Sending everything to the trailing note
    // scrolled the page to the bottom whenever the click fell in a gap
    // between blocks or beside a todo — even while just reading.
    const els = [...articleEl.querySelectorAll<HTMLElement>('.block[data-bid]')]
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (e.clientY < r.top || e.clientY > r.bottom) continue
      const bid = Number(el.dataset.bid)
      const target = doc.blocks.find((b) => idOf(b) === bid)
      // Beside a todo/code block: nothing sensible to focus — no jump.
      if (target?.type === 'note') noteApis.get(target)?.focusAt(e.clientX, e.clientY)
      return
    }
    // Below the last block: the trailing note grows to meet the click.
    const lastEl = els[els.length - 1]
    if (lastEl && e.clientY > lastEl.getBoundingClientRect().bottom) {
      const last = doc.blocks[doc.blocks.length - 1]
      if (last?.type === 'note') noteApis.get(last)?.focusAt(e.clientX, e.clientY)
    }
    // Gaps between blocks: deliberately inert.
  }

  function onTitleInput(e: Event) {
    if (!doc) return
    const el = e.target as HTMLTextAreaElement
    // Frontmatter titles are single-line: pasted newlines become spaces.
    if (el.value.includes('\n')) el.value = el.value.replace(/\n+/g, ' ')
    doc.frontmatter.title = el.value
    autosize(el)
    scheduleSave()
  }

  // Enter on the title drops into the page body, ready to write.
  function onTitleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || !doc) return
    e.preventDefault()
    const last = doc.blocks[doc.blocks.length - 1]
    if (last?.type === 'note') noteApis.get(last)?.focusEnd()
  }
</script>

<svelte:window onfocus={onWindowFocus} />

{#if doc}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <article
    class="doc-outer"
    bind:this={articleEl}
    class:drag-over={dragOver}
    style={dragOver && dragKinds.length === 1 ? `--drag-accent: ${DROP_COLORS[dragKinds[0]]}` : ''}
    onpointerdown={onPointerDown}
    onclick={onBackgroundClick}
    ondragover={onDragOver}
    ondragleave={() => (dragOver = false)}
    ondrop={onDrop}
  >
    {#if dragOver}
      <div class="drop-overlay">
        {#if dragKinds.length > 0}
          {#each dragKinds as kind (kind)}
            <div class="drop-badge drop-{kind}">
              {#if kind === 'image'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="M3.5 17l4.5-4.5 3.5 3.5 3.5-3.5 5.5 5.5" />
                </svg>
              {:else if kind === 'video'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="2.5" y="6.5" width="13" height="11" rx="2" />
                  <path d="M15.5 10.5l6-3.5v10l-6-3.5" />
                </svg>
              {:else if kind === 'pdf'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
                  <path d="M14 3v5h5" />
                  <path d="M8.5 13h7M8.5 16.5h7" />
                </svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="4" y="5" width="16" height="14" rx="1.5" />
                  <path d="M4 10h16M4 14.5h16M9.5 5v14M14.75 10v9" />
                </svg>
              {/if}
              <span>{$t(`drop.${kind}`)}</span>
            </div>
          {/each}
        {:else}
          <div class="drop-badge drop-generic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
              <path d="M14 3v5h5" />
              <path d="M12 11v6M9.5 14.5l2.5 2.5 2.5-2.5" />
            </svg>
            <span>{$t('drop.generic')}</span>
            <span class="drop-formats">{$t('drop.formats')}</span>
          </div>
        {/if}
      </div>
    {/if}
    <div class="doc-inner">
      <div class="doc-head">
        {#if isJournal}
          <h1 class="doc-title">{formatDayFull(journalDay, $lang)}</h1>
        {:else}
          <!-- A textarea (not an input) so long titles wrap to more lines
               instead of clipping; Enter still drops into the body. -->
          <textarea
            class="doc-title-input"
            bind:this={titleInput}
            rows="1"
            value={doc.frontmatter.title ?? baseName}
            placeholder={$t('doc.titlePh')}
            use:fit
            oninput={onTitleInput}
            onkeydown={onTitleKeydown}
          ></textarea>
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
            <TodoBlock {block} autostart={block === freshTodo} onedit={scheduleSave} onremove={() => removeBlock(block)} />
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
              oninsert={insertSpecial}
              {onnavigate}
            />
          {/if}
          {#if block.type === 'code'}
            <button class="block-delete" title={$t('block.remove')} onclick={() => removeBlock(block)}>×</button>
          {/if}
        </div>
      {/each}
    </div>
  </article>

{/if}

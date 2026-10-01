// Markdown <-> blocks. Line-based on purpose: no remark/unified.
// Invariant: parseDocument(serializeDocument(doc)) deep-equals doc
// for any doc produced by parseDocument.

export interface TodoItem {
  done: boolean
  text: string
  /** Blank line(s) above this item in the file. Items separated only by
   *  blank lines are still one list (one "N completed" group); the flag
   *  keeps the file's spacing intact on save. */
  gap?: boolean
  /** Local "YYYY-MM-DD HH:MM" the item was created / checked, stored in a
   *  trailing `<!-- brain created="…" done="…" -->` comment (invisible in
   *  any markdown renderer, still plain text for whoever reads the file). */
  created?: string
  doneAt?: string
}

export type Block =
  | { type: 'todo'; items: TodoItem[] }
  | { type: 'code'; language: string; code: string; label: string; pinned: boolean }
  | { type: 'note'; text: string }

export type Frontmatter = Record<string, string>

export interface BrainDoc {
  frontmatter: Frontmatter
  blocks: Block[]
}

const TODO_RE = /^- \[([ xX])\](?: (.*))?$/
const FENCE_RE = /^(`{3,})([^`\s]*)\s*$/
// Block metadata lives in an HTML comment on the line above the fence:
//   <!-- brain label="Top users query" pinned -->
const BRAIN_RE = /^<!--\s*brain\b(.*?)-->\s*$/
const LABEL_RE = /label="((?:[^"\\]|\\.)*)"/
const ITEM_META_RE = /\s*<!--\s*brain\b(.*?)-->\s*$/
const STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/

/** Current local time as stored in todo metadata: "2026-10-01 12:48". */
export function stampNow(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function parseItem(mark: string, raw: string | undefined): TodoItem {
  const item: TodoItem = { done: mark !== ' ', text: raw ?? '' }
  const meta = item.text.match(ITEM_META_RE)
  if (meta) {
    const created = meta[1].match(/created="([^"]*)"/)?.[1]
    const done = meta[1].match(/done="([^"]*)"/)?.[1]
    // Only well-formed stamps are ours; anything else stays in the text.
    if ((created && STAMP_RE.test(created)) || (done && STAMP_RE.test(done))) {
      item.text = item.text.slice(0, meta.index)
      if (created && STAMP_RE.test(created)) item.created = created
      if (done && STAMP_RE.test(done)) item.doneAt = done
    }
  }
  return item
}

export function parseDocument(content: string): BrainDoc {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const [frontmatter, bodyStart] = parseFrontmatter(lines)
  return { frontmatter, blocks: parseBlocks(lines, bodyStart) }
}

function parseFrontmatter(lines: string[]): [Frontmatter, number] {
  if (lines[0] !== '---') return [{}, 0]
  const fm: Frontmatter = {}
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return [fm, i + 1]
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s?(.*)$/)
    if (m) fm[m[1]] = m[2]
  }
  // Unterminated frontmatter: treat the whole file as body.
  return [{}, 0]
}

function isMetaForFence(lines: string[], i: number): boolean {
  return BRAIN_RE.test(lines[i]) && i + 1 < lines.length && FENCE_RE.test(lines[i + 1])
}

function parseBlocks(lines: string[], start: number): Block[] {
  const blocks: Block[] = []
  let i = start

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // Metadata comment directly above a fence.
    let label = ''
    let pinned = false
    if (isMetaForFence(lines, i)) {
      const meta = line.match(BRAIN_RE)![1]
      const lm = meta.match(LABEL_RE)
      if (lm) label = lm[1].replace(/\\(.)/g, '$1')
      // Strip the label first so a label containing "pinned" can't match.
      pinned = /\bpinned\b/.test(lm ? meta.replace(lm[0], '') : meta)
      i++
    }

    const fence = lines[i].match(FENCE_RE)
    if (fence) {
      const closeRe = new RegExp('^`{' + fence[1].length + ',}\\s*$')
      const codeLines: string[] = []
      i++
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip closing fence
      blocks.push({ type: 'code', language: fence[2], code: codeLines.join('\n'), label, pinned })
      continue
    }

    const todo = line.match(TODO_RE)
    if (todo) {
      const items: TodoItem[] = []
      while (i < lines.length) {
        const l = lines[i]
        const m = l.match(TODO_RE)
        if (m) {
          items.push(parseItem(m[1], m[2]))
          i++
          continue
        }
        // Hard-wrapped items (files written by hand or by other tools):
        // an indented line right under an item is its continuation — left
        // in a note block, its 4 spaces of indent would render as code.
        // An indented `- [ ]` is a nested item and joins the list flat.
        if (/^[ \t]+\S/.test(l)) {
          const trimmed = l.trim()
          const nested = trimmed.match(TODO_RE)
          if (nested) {
            items.push(parseItem(nested[1], nested[2]))
          } else {
            const last = items[items.length - 1]
            last.text = last.text === '' ? trimmed : last.text + ' ' + trimmed
          }
          i++
          continue
        }
        // Blank line(s) followed by an indented continuation still belong
        // to the item (a common hand-written shape); blank lines between
        // two items keep the list going (remembered as a gap, so the file
        // keeps its spacing); blanks before anything else end the block.
        if (l.trim() === '') {
          let j = i
          while (j < lines.length && lines[j].trim() === '') j++
          if (j < lines.length && /^[ \t]+\S/.test(lines[j])) {
            i = j
            continue
          }
          if (j < lines.length && TODO_RE.test(lines[j])) {
            i = j
            const next = lines[i].match(TODO_RE)!
            const item = parseItem(next[1], next[2])
            item.gap = true
            items.push(item)
            i++
            continue
          }
        }
        break
      }
      blocks.push({ type: 'todo', items })
      continue
    }

    // Note: everything until the next special block. Blank lines stay inside
    // the note so plain prose reads as one continuous editable area; only the
    // trailing separator blanks are trimmed (round-trip safe).
    const noteLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (FENCE_RE.test(l) || TODO_RE.test(l) || isMetaForFence(lines, i)) break
      noteLines.push(l)
      i++
    }
    while (noteLines.length > 0 && noteLines[noteLines.length - 1].trim() === '') noteLines.pop()
    blocks.push({ type: 'note', text: noteLines.join('\n') })
  }

  return blocks
}

export function serializeDocument(doc: BrainDoc): string {
  const parts: string[] = []
  const keys = Object.keys(doc.frontmatter)
  if (keys.length > 0) {
    parts.push('---\n' + keys.map((k) => `${k}: ${doc.frontmatter[k]}`).join('\n') + '\n---')
  }
  for (const block of doc.blocks) {
    // Empty notes are UI padding around special blocks, not content.
    if (block.type === 'note' && block.text.trim() === '') continue
    parts.push(serializeBlock(block))
  }
  return parts.join('\n\n') + '\n'
}

export function serializeBlock(block: Block): string {
  if (block.type === 'todo') {
    return block.items
      .map((it, i) => {
        let meta = ''
        if (it.created || it.doneAt) {
          meta = '<!-- brain'
          if (it.created) meta += ` created="${it.created}"`
          if (it.doneAt) meta += ` done="${it.doneAt}"`
          meta += ' -->'
        }
        const body = [it.text, meta].filter(Boolean).join(' ')
        return `${i > 0 && it.gap ? '\n' : ''}- [${it.done ? 'x' : ' '}]${body ? ' ' + body : ''}`
      })
      .join('\n')
  }

  if (block.type === 'code') {
    const lines: string[] = []
    if (block.label || block.pinned) {
      let meta = '<!-- brain'
      if (block.label) {
        meta += ` label="${block.label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      }
      if (block.pinned) meta += ' pinned'
      lines.push(meta + ' -->')
    }
    // Lengthen the fence if the code itself contains backtick runs.
    let fence = '```'
    const runs = block.code.match(/`{3,}/g)
    if (runs) fence = '`'.repeat(Math.max(...runs.map((r) => r.length)) + 1)
    lines.push(fence + block.language)
    if (block.code !== '') lines.push(block.code)
    lines.push(fence)
    return lines.join('\n')
  }

  return block.text
}

// Markdown <-> blocks. Line-based on purpose: no remark/unified.
// Invariant: parseDocument(serializeDocument(doc)) deep-equals doc
// for any doc produced by parseDocument.

export interface TodoItem {
  done: boolean
  text: string
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
        const m = lines[i].match(TODO_RE)
        if (!m) break
        items.push({ done: m[1] !== ' ', text: m[2] ?? '' })
        i++
      }
      blocks.push({ type: 'todo', items })
      continue
    }

    // Note: consecutive lines until a blank line or another block type.
    const noteLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (l.trim() === '' || FENCE_RE.test(l) || TODO_RE.test(l) || isMetaForFence(lines, i)) break
      noteLines.push(l)
      i++
    }
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
    parts.push(serializeBlock(block))
  }
  return parts.join('\n\n') + '\n'
}

export function serializeBlock(block: Block): string {
  if (block.type === 'todo') {
    return block.items
      .map((it) => `- [${it.done ? 'x' : ' '}]${it.text ? ' ' + it.text : ''}`)
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

// Markdown (GFM) pipe tables: parsing with offsets, pretty-printing and the
// row/column edits the table widget's menu offers. Kept CodeMirror-free and
// side-effect free so it is unit-testable on its own.

export type Align = 'left' | 'center' | 'right' | null

/** One cell: its trimmed text plus where that text sits in the raw source. */
export interface TableCell {
  text: string
  from: number
  to: number
}

export interface TableLine {
  cells: TableCell[]
  /** Offsets of the whole source line. */
  from: number
  to: number
}

export interface ParsedTable {
  header: TableLine
  align: Align[]
  body: TableLine[]
  /** Number of columns, taken from the header row. */
  cols: number
}

/** `|---|:--:|` and friends: the row that turns pipes into a table. */
export function isDelimiterRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('-')) return false
  const cells = splitCells(t)
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.text.trim()))
}

/** Does this line look like part of a table (has an unescaped pipe)? */
export function looksLikeTableLine(line: string): boolean {
  return /(^|[^\\])\|/.test(line)
}

function alignOf(spec: string): Align {
  const s = spec.trim()
  const left = s.startsWith(':')
  const right = s.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

/**
 * Split one raw table row into cells. Pipes escaped with a backslash stay
 * in the text (GFM rule: inside code spans they do NOT, a pipe always
 * splits unless escaped). Offsets are relative to `base`.
 */
function splitCells(line: string, base = 0): TableCell[] {
  const cells: TableCell[] = []
  let start = 0
  let i = 0
  const push = (from: number, to: number) => {
    const raw = line.slice(from, to)
    const lead = raw.length - raw.trimStart().length
    const trail = raw.length - raw.trimEnd().length
    cells.push({ text: raw.trim(), from: base + from + lead, to: base + to - trail })
  }
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2
      continue
    }
    if (line[i] === '|') {
      // A leading pipe opens the row rather than closing an empty first cell.
      if (!(cells.length === 0 && line.slice(start, i).trim() === '')) push(start, i)
      start = i + 1
    }
    i++
  }
  const tail = line.slice(start)
  // Same for the trailing pipe: what follows it is padding, not a cell.
  if (tail.trim() !== '' || cells.length === 0) push(start, line.length)
  return cells
}

/**
 * Parse a table's source (the exact slice of the document). Returns null
 * when it is not a table: fewer than two lines, or no delimiter row second.
 */
export function parseTable(src: string): ParsedTable | null {
  const lines = src.split('\n')
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null
  const offsets: number[] = []
  let at = 0
  for (const l of lines) {
    offsets.push(at)
    at += l.length + 1
  }
  const lineOf = (i: number): TableLine => ({
    cells: splitCells(lines[i], offsets[i]),
    from: offsets[i],
    to: offsets[i] + lines[i].length
  })
  const header = lineOf(0)
  const align = splitCells(lines[1]).map((c) => alignOf(c.text))
  const body: TableLine[] = []
  for (let i = 2; i < lines.length; i++) {
    if (lines[i].trim() === '') break
    body.push(lineOf(i))
  }
  return { header, align, body, cols: header.cells.length }
}

/** Cell texts as a plain grid (header first), padded to `cols`. */
export function toGrid(table: ParsedTable): string[][] {
  const row = (l: TableLine) => {
    const cells = l.cells.map((c) => c.text)
    while (cells.length < table.cols) cells.push('')
    return cells.slice(0, table.cols)
  }
  return [row(table.header), ...table.body.map(row)]
}

/** Visible width of a cell: the pipes we add escape nothing, so it is just
 *  the character count (astral characters count once). */
function width(text: string): number {
  return [...text].length
}

/**
 * Pretty-print a grid as an aligned pipe table — the "format it properly"
 * half of the feature. Columns are padded to their widest cell so the raw
 * markdown reads as a table outside the app too.
 */
export function serializeTable(grid: string[][], align: Align[]): string {
  const cols = Math.max(...grid.map((r) => r.length), align.length, 1)
  const widths: number[] = []
  for (let c = 0; c < cols; c++) {
    // Three dashes is the narrowest delimiter that still reads as one.
    widths.push(Math.max(3, ...grid.map((r) => width(r[c] ?? ''))))
  }
  const pad = (text: string, c: number) => {
    const gap = widths[c] - width(text)
    const a = align[c]
    if (a === 'right') return ' '.repeat(gap) + text
    if (a === 'center') {
      const left = Math.floor(gap / 2)
      return ' '.repeat(left) + text + ' '.repeat(gap - left)
    }
    return text + ' '.repeat(gap)
  }
  const row = (cells: string[]) =>
    '| ' + Array.from({ length: cols }, (_, c) => pad(cells[c] ?? '', c)).join(' | ') + ' |'
  const delim = (c: number) => {
    const a = align[c]
    const inner = '-'.repeat(widths[c] - (a === 'center' ? 2 : a ? 1 : 0))
    if (a === 'center') return ':' + inner + ':'
    if (a === 'right') return inner + ':'
    if (a === 'left') return ':' + inner
    return inner
  }
  const lines = [
    row(grid[0] ?? []),
    '| ' + Array.from({ length: cols }, (_, c) => delim(c)).join(' | ') + ' |',
    ...grid.slice(1).map(row)
  ]
  return lines.join('\n')
}

/** Re-print a table source with aligned columns, keeping the content. */
export function tidyTable(src: string): string | null {
  const table = parseTable(src)
  if (!table) return null
  return serializeTable(toGrid(table), table.align)
}

// ---------- Structural edits (the widget's context menu) ----------

export function insertRow(grid: string[][], at: number): string[][] {
  const out = grid.map((r) => [...r])
  out.splice(Math.max(1, at), 0, new Array(grid[0]?.length ?? 1).fill(''))
  return out
}

export function deleteRow(grid: string[][], at: number): string[][] {
  // The header is what makes it a table: it never goes.
  if (at < 1 || grid.length <= 2) return grid
  return grid.filter((_, i) => i !== at).map((r) => [...r])
}

export function insertColumn(grid: string[][], align: Align[], at: number): [string[][], Align[]] {
  const out = grid.map((r) => {
    const row = [...r]
    row.splice(at, 0, '')
    return row
  })
  const a = [...align]
  a.splice(at, 0, null)
  return [out, a]
}

export function deleteColumn(grid: string[][], align: Align[], at: number): [string[][], Align[]] {
  if ((grid[0]?.length ?? 0) <= 1) return [grid, align]
  return [grid.map((r) => r.filter((_, i) => i !== at)), align.filter((_, i) => i !== at)]
}

export function setAlign(align: Align[], at: number, value: Align): Align[] {
  const a = [...align]
  while (a.length <= at) a.push(null)
  a[at] = value
  return a
}

// ---------- Tables that lost their newlines ----------

/**
 * Turn a table squashed onto a single line back into a real one. Pasting a
 * table into a place that keeps only one line (a todo item, a chat) glues
 * the rows together as `… | | 1 | …`; the row boundary is the `| |` seam,
 * or `|` immediately followed by the next row's leading pipe.
 */
export function unflattenTable(text: string): string | null {
  const line = text.trim()
  if (line.includes('\n') || !line.startsWith('|')) return null
  // Rows are split on the seam between a closing and an opening pipe.
  const rows = line
    .split(/\|\s*\|/)
    .map((part, i, all) => {
      const open = i === 0 ? '' : '|'
      const close = i === all.length - 1 ? '' : '|'
      return (open + part + close).trim()
    })
    .filter((r) => r.replace(/\|/g, '').trim() !== '')
  if (rows.length < 2 || !isDelimiterRow(rows[1])) return null
  const table = parseTable(rows.join('\n'))
  if (!table) return null
  return serializeTable(toGrid(table), table.align)
}

/** An empty 3x2 table, used by the insert menu. */
export function emptyTable(cols = 3, rows = 2): string {
  const grid = [
    Array.from({ length: cols }, (_, i) => `Col ${i + 1}`),
    ...Array.from({ length: rows }, () => new Array(cols).fill(''))
  ]
  return serializeTable(grid, new Array(cols).fill(null))
}

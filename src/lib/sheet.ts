// Spreadsheet (xlsx/xls/ods/csv) → markdown pipe tables, the same tables
// the editor renders. SheetJS is heavy, so it loads only when a sheet is
// actually converted.

import { serializeTable, type Align } from './table'

/** Past this many rows a sheet is cut: a note is not a spreadsheet. */
export const MAX_ROWS = 500

export interface SheetTables {
  markdown: string
  truncated: boolean
}

const cell = (v: unknown) =>
  String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()

/** One table per non-empty sheet; with several sheets each gets its name
 *  in bold above it. Numeric columns are right-aligned. */
export async function sheetToMarkdown(data: ArrayBuffer | string): Promise<SheetTables | null> {
  const XLSX = await import('xlsx')
  const wb = typeof data === 'string' ? XLSX.read(data, { type: 'string' }) : XLSX.read(data, { type: 'array' })
  const parts: string[] = []
  let truncated = false
  const named = wb.SheetNames.length > 1
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false
    })
    let grid = rows.map((r) => r.map(cell))
    // Trailing empty columns (formatting left in the file) are noise.
    let cols = Math.max(0, ...grid.map((r) => r.length))
    while (cols > 0 && grid.every((r) => (r[cols - 1] ?? '') === '')) cols--
    grid = grid.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ''))
    if (cols === 0 || grid.length === 0) continue
    if (grid.length > MAX_ROWS + 1) {
      grid = grid.slice(0, MAX_ROWS + 1)
      truncated = true
    }
    if (grid.length === 1) grid.push(Array(cols).fill(''))
    const numeric = (c: number) => {
      const body = grid.slice(1).map((r) => r[c]).filter((v) => v !== '')
      return body.length > 0 && body.every((v) => /^[-+]?[\d.,\s]+%?$|^[-+]?[€$£]\s?[\d.,]+$/.test(v))
    }
    const align: Align[] = Array.from({ length: cols }, (_, c) => (numeric(c) ? 'right' : null))
    parts.push((named ? `**${cell(name)}**\n\n` : '') + serializeTable(grid, align))
  }
  if (parts.length === 0) return null
  return { markdown: parts.join('\n\n'), truncated }
}

// Markdown inline-format toggling for plain text fields (todo items).
// The note editor has the syntax tree for this; here the text is a single
// line, so marker runs around the selection are inspected directly.

/** Menu entries shared by notes and todos: i18n key + marker pair. */
export const FORMATS = [
  ['fmt.bold', '**'],
  ['fmt.italic', '*'],
  ['fmt.code', '`'],
  ['fmt.strike', '~~']
] as const

/** Length of the run of `ch` going left (dir -1, from i-1) or right (dir 1, from i). */
function runLen(s: string, i: number, ch: string, dir: -1 | 1): number {
  let n = 0
  let j = dir < 0 ? i - 1 : i
  while (j >= 0 && j < s.length && s[j] === ch) {
    n++
    j += dir
  }
  return n
}

/**
 * Toggle `marker` on [selStart, selEnd) of `value`. An empty selection
 * expands to the word under the caret. Returns the new text and selection,
 * or null when there is nothing to do (no word, or the span is inside
 * inline code, which markdown cannot format).
 */
export function toggleMarkerInText(
  value: string,
  selStart: number,
  selEnd: number,
  marker: string
): { value: string; start: number; end: number } | null {
  const len = marker.length
  const ch = marker[0]
  let start = Math.min(selStart, selEnd)
  let end = Math.max(selStart, selEnd)
  if (start === end) {
    const isWord = (c: string) => !/[\s`*~]/.test(c)
    while (start > 0 && isWord(value[start - 1])) start--
    while (end < value.length && isWord(value[end])) end++
    if (start === end) return null
  }
  // Inline code owns its span: markdown cannot style text inside `code`,
  // so bold/italic/strike over coded text deliberately do nothing.
  if (marker !== '`') {
    const ticksBefore = runsOf(value.slice(0, start))
    if (ticksBefore % 2 === 1 && value.indexOf('`', end) !== -1) return null
  }

  // Markers directly around the selection -> remove that pair.
  const nb = runLen(value, start, ch, -1)
  const na = runLen(value, end, ch, 1)
  if (nb >= len && na >= len && starRunFits(marker, nb)) {
    const out = value.slice(0, start - len) + value.slice(start, end) + value.slice(end + len)
    return { value: out, start: start - len, end: end - len }
  }

  // Markers inside the selection (pair selected along) -> strip them.
  const sel = value.slice(start, end)
  if (sel.length >= 2 * len && sel.startsWith(marker) && sel.endsWith(marker)) {
    const rs = runLen(sel, 0, ch, 1)
    if (starRunFits(marker, rs)) {
      const out = value.slice(0, start) + sel.slice(len, sel.length - len) + value.slice(end)
      return { value: out, start, end: end - 2 * len }
    }
  }

  const out = value.slice(0, start) + marker + value.slice(start, end) + marker + value.slice(end)
  return { value: out, start: start + len, end: end + len }
}

function runsOf(s: string): number {
  return (s.match(/`/g) ?? []).length
}

// ---------- Rendering (todo items show styled text while not editing) ----------

const INLINE_RENDER_RE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Render one raw markdown line as HTML: **bold**, *italic*, `code`,
 * ~~strike~~ (single level, matching what the toggles produce). Every
 * span carries data-r = the raw offset of its first character, so a click
 * on the rendered text maps back to a caret position in the raw string.
 */
export function renderInlineMarkdown(text: string): string {
  let html = ''
  let last = 0
  INLINE_RENDER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_RENDER_RE.exec(text))) {
    if (m.index > last) {
      html += `<span data-r="${last}">${escapeHtml(text.slice(last, m.index))}</span>`
    }
    const token = m[0]
    const len = token.startsWith('**') || token.startsWith('~~') ? 2 : 1
    const cls = token.startsWith('**') ? 'tr-b' : token.startsWith('~~') ? 'tr-s' : token.startsWith('`') ? 'tr-c' : 'tr-i'
    html += `<span class="${cls}" data-r="${m.index + len}">${escapeHtml(token.slice(len, token.length - len))}</span>`
    last = m.index + token.length
  }
  if (last < text.length) {
    html += `<span data-r="${last}">${escapeHtml(text.slice(last))}</span>`
  }
  return html
}

/** `*` must not eat one star of a `**` pair: italic is only present when
 *  the star run is odd; bold needs at least two. Other markers just fit. */
function starRunFits(marker: string, run: number): boolean {
  if (marker === '*') return run % 2 === 1
  if (marker === '**') return run >= 2
  return true
}

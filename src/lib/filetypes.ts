// Every non-image file a note can hold, in one CodeMirror-free module so
// both the editor (cards, paste) and DocView (drop overlay, kept out of the
// editor chunk) read the same table instead of duplicating regexes.

export type FileKind = 'pdf' | 'csv' | 'sheet' | 'doc' | 'slides' | 'text' | 'archive'
export type DropKind = 'image' | 'video' | 'audio' | FileKind

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  log: 'text/plain',
  zip: 'application/zip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  gz: 'application/gzip',
  tar: 'application/x-tar'
}

const EXT_KIND: Record<string, FileKind> = {
  pdf: 'pdf',
  csv: 'csv',
  xlsx: 'sheet', xls: 'sheet', ods: 'sheet',
  docx: 'doc', doc: 'doc', odt: 'doc', rtf: 'doc',
  pptx: 'slides', ppt: 'slides', odp: 'slides',
  txt: 'text', md: 'text', json: 'text', xml: 'text', yaml: 'text', yml: 'text', log: 'text',
  zip: 'archive', '7z': 'archive', rar: 'archive', gz: 'archive', tar: 'archive'
}

export const VIDEO_SRC_RE = /\.(mp4|mov|m4v|webm)$/i
export const AUDIO_SRC_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i
export const FILE_SRC_RE = new RegExp(`\\.(${Object.keys(EXT_KIND).join('|')})$`, 'i')

export const extOf = (name: string) => (name.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase()
export const fileKindOf = (src: string): FileKind | null => EXT_KIND[extOf(src)] ?? null
export const mimeOf = (src: string) => EXT_MIME[extOf(src)] ?? 'application/octet-stream'

/** Kinds whose content the browser can show in a tab as text. */
export const OPENS_AS_TEXT: ReadonlySet<FileKind> = new Set(['csv', 'text'])

/** Drag-time kind from the MIME type alone (filenames aren't readable
 *  until drop). Windows reports .csv as an Excel type, so it stays "csv". */
export function kindOfType(type: string): DropKind | null {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  if (type === 'text/csv' || type === 'application/vnd.ms-excel') return 'csv'
  const ext = Object.keys(EXT_MIME).find((e) => EXT_MIME[e] === type)
  if (ext) return EXT_KIND[ext]
  if (type.startsWith('text/')) return 'text'
  return null
}

/** Media accepted by paste/drop: by MIME, or by extension when the MIME is
 *  missing (some .mov and Office drags arrive with an empty type). */
export function isMediaFile(file: File): boolean {
  return (
    kindOfType(file.type) !== null ||
    VIDEO_SRC_RE.test(file.name) ||
    AUDIO_SRC_RE.test(file.name) ||
    FILE_SRC_RE.test(file.name)
  )
}

// Fixed hues (not theme variables) so red always reads "PDF", green "sheet".
export const KIND_COLORS: Record<DropKind, string> = {
  image: '#3b82f6',
  video: '#8b5cf6',
  audio: '#d6409f',
  pdf: '#e5484d',
  csv: '#30a46c',
  sheet: '#1f8a4c',
  doc: '#3e63dd',
  slides: '#e5711d',
  text: '#8b8d98',
  archive: '#b8860b'
}

// Monochrome SVG icons (no emoji anywhere in the UI).
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const SHEET = '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/>'

export const KIND_ICONS: Record<DropKind, string> = {
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M3.5 17l4.5-4.5 3.5 3.5 3.5-3.5 5.5 5.5"/>'),
  video: svg('<rect x="2.5" y="6.5" width="13" height="11" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5"/>'),
  audio: svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  pdf: svg(SHEET + '<path d="M8.5 13h7M8.5 16.5h7"/>'),
  csv: svg('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M9.5 5v14M14.75 10v9"/>'),
  sheet: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 14.75h16M10 9.5V20"/><path d="M13 5.5l3 2.5M16 5.5l-3 2.5"/>'),
  doc: svg(SHEET + '<path d="M8.5 12h7M8.5 15h7M8.5 18h4"/>'),
  slides: svg('<rect x="3" y="4.5" width="18" height="12" rx="1.5"/><path d="M12 16.5V20M8.5 20h7"/><path d="M7 12.5l3-3 2.5 2 3.5-3.5"/>'),
  text: svg(SHEET + '<path d="M8.5 12.5h3M8.5 16h7"/>'),
  archive: svg('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M12 3.5v2M12 7.5v2M12 11.5v2"/><rect x="10.5" y="14.5" width="3" height="3" rx="0.8"/>')
}

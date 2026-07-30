import { derived, writable } from 'svelte/store'

export type Lang = 'en' | 'it'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('brain:lang')
    if (saved === 'en' || saved === 'it') return saved
  } catch {
    // localStorage unavailable: fall through.
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('it')) {
    return 'it'
  }
  return 'en'
}

export const lang = writable<Lang>(initialLang())
lang.subscribe((l) => {
  try {
    localStorage.setItem('brain:lang', l)
  } catch {
    // Ignore: language just won't persist.
  }
})

const en: Record<string, string> = {
  'sidebar.notes': 'Notes',
  'sidebar.journal': 'Journal',
  'sidebar.ideas': 'Ideas',
  'sidebar.ideaStream': 'Idea stream',
  'sidebar.today': 'Today',
  'sidebar.newNote': 'New note (Ctrl/Cmd+N or Alt+N)',
  'sidebar.newNotePh': 'Note title, Enter to create',
  'sidebar.newFolder': 'New folder',
  'sidebar.newFolderPh': 'Folder name, Enter to create',
  'sidebar.noNotes': 'No notes yet',
  'sidebar.emptyFolder': 'Drag notes here',
  'sidebar.export': 'Export all as JSON',
  'sidebar.hint': 'Your folder is the data. Plain Markdown, no lock-in.',
  'sidebar.collapse': 'Collapse sidebar',
  'sidebar.expand': 'Expand sidebar',
  'screen.unsupported':
    'Brain stores your notes as plain files on your disk via the File System Access API, which this browser does not support. Please use Chrome or Edge.',
  'screen.welcome':
    'Local-first notes for developers. Pick a folder — everything stays on your disk as plain Markdown. No accounts, no cloud, no telemetry.',
  'screen.choose': 'Choose a folder',
  'screen.reconnectMsg': 'Permission to your notes folder expired with the browser session.',
  'screen.reconnect': 'Reconnect folder',
  'todo.ph': 'To do…',
  'code.labelPh': 'Label this query…',
  'code.langPh': 'lang',
  'code.copy': 'Copy code',
  'code.copyBtn': 'Copy',
  'code.pin': 'Pin to palette (Cmd/Ctrl+K)',
  'code.unpin': 'Unpin from palette',
  'insert.title': 'Insert block',
  'insert.todo': 'Todo',
  'insert.code': 'Code',
  'block.remove': 'Remove block',
  'doc.titlePh': 'Untitled',
  'doc.deleteTooltip': 'Delete document',
  'doc.deleteTitle': 'Delete permanently?',
  'doc.deleteMsg': '“{name}” will be deleted from disk. This cannot be undone.',
  'doc.cancel': 'Cancel',
  'doc.delete': 'Delete',
  'palette.ph': 'Search pinned snippets…',
  'palette.none': 'No pinned snippets yet — pin a code block with ☆',
  'palette.noMatch': 'No match',
  'ideas.title': 'Ideas',
  'ideas.ph': 'Capture an idea — Enter to save',
  'ideas.empty': 'Nothing yet. Ideas land here, newest first.',
  'folder.title': 'Folder',
  'folder.connected': 'Connected folder',
  'folder.permission': 'Permission',
  'folder.granted': 'granted',
  'folder.prompt': 'needs a one-click reconnect',
  'folder.change': 'Change folder…',
  'folder.note':
    'The folder choice is remembered by this browser. After a full browser restart Chrome may ask you to reconnect with a single click; in recent versions choose “Allow on every visit” in the permission prompt to skip even that.',
  'folder.live': 'Listed live from your disk.',
  'folder.indexNote': 'snippet & title cache, safe to delete',
  'folder.empty': 'empty',
  'bar.download': 'Download as .txt',
  'bar.theme': 'Change color theme',
  'bar.font': 'Change font',
  'bar.hideMarkup': 'Hide markdown formatting',
  'bar.showMarkup': 'Show markdown formatting',
  'bar.fullscreen': 'Toggle full screen',
  'img.copy': 'Copy image',
  'media.delete': 'Remove from note',
  'video.download': 'Download video',
  'file.open': 'Open',
  'file.download': 'Download file',
  'csv.copy': 'Copy contents',
  'drop.image': 'Drop image',
  'drop.video': 'Drop video',
  'drop.pdf': 'Drop PDF',
  'drop.csv': 'Drop CSV',
  'drop.generic': 'Drop file',
  'drop.formats': 'Images · video · PDF · CSV',
  'toast.imgCopied': 'Image copied',
  'toast.copied': 'Copied to clipboard',
  'toast.copyFail': 'Could not copy',
  'toast.snippet': 'Snippet copied',
  'toast.exported': 'Exported JSON',
  'toast.deleted': 'Deleted',
  'lang.switch': 'Italiano'
}

const it: Record<string, string> = {
  'sidebar.notes': 'Note',
  'sidebar.journal': 'Diario',
  'sidebar.ideas': 'Idee',
  'sidebar.ideaStream': 'Flusso di idee',
  'sidebar.today': 'Oggi',
  'sidebar.newNote': 'Nuova nota (Ctrl/Cmd+N o Alt+N)',
  'sidebar.newNotePh': 'Titolo della nota, Invio per creare',
  'sidebar.newFolder': 'Nuova cartella',
  'sidebar.newFolderPh': 'Nome cartella, Invio per creare',
  'sidebar.noNotes': 'Ancora nessuna nota',
  'sidebar.emptyFolder': 'Trascina qui le note',
  'sidebar.export': 'Esporta tutto in JSON',
  'sidebar.hint': 'La tua cartella è i tuoi dati. Markdown puro, nessun lock-in.',
  'sidebar.collapse': 'Comprimi la barra laterale',
  'sidebar.expand': 'Espandi la barra laterale',
  'screen.unsupported':
    'Brain salva le note come semplici file sul tuo disco tramite la File System Access API, che questo browser non supporta. Usa Chrome o Edge.',
  'screen.welcome':
    'Note local-first per sviluppatori. Scegli una cartella: tutto resta sul tuo disco come semplice Markdown. Niente account, niente cloud, niente telemetria.',
  'screen.choose': 'Scegli una cartella',
  'screen.reconnectMsg': 'Il permesso sulla cartella delle note è scaduto con la sessione del browser.',
  'screen.reconnect': 'Ricollega la cartella',
  'todo.ph': 'Da fare…',
  'code.labelPh': 'Etichetta questa query…',
  'code.langPh': 'lang',
  'code.copy': 'Copia il codice',
  'code.copyBtn': 'Copia',
  'code.pin': 'Fissa nella palette (Cmd/Ctrl+K)',
  'code.unpin': 'Rimuovi dalla palette',
  'insert.title': 'Inserisci blocco',
  'insert.todo': 'Todo',
  'insert.code': 'Codice',
  'block.remove': 'Rimuovi blocco',
  'doc.titlePh': 'Senza titolo',
  'doc.deleteTooltip': 'Elimina documento',
  'doc.deleteTitle': 'Eliminare definitivamente?',
  'doc.deleteMsg': '“{name}” verrà eliminato dal disco. Non si può annullare.',
  'doc.cancel': 'Annulla',
  'doc.delete': 'Elimina',
  'palette.ph': 'Cerca gli snippet fissati…',
  'palette.none': 'Nessuno snippet fissato — fissa un blocco di codice con ☆',
  'palette.noMatch': 'Nessun risultato',
  'ideas.title': 'Idee',
  'ideas.ph': "Cattura un'idea — Invio per salvare",
  'ideas.empty': 'Ancora niente. Le idee arrivano qui, le più recenti in alto.',
  'folder.title': 'Cartella',
  'folder.connected': 'Cartella collegata',
  'folder.permission': 'Permesso',
  'folder.granted': 'concesso',
  'folder.prompt': 'serve un clic per ricollegarla',
  'folder.change': 'Cambia cartella…',
  'folder.note':
    'La scelta della cartella viene ricordata da questo browser. Dopo un riavvio completo Chrome può chiederti di ricollegarla con un solo clic; nelle versioni recenti scegli “Consenti a ogni visita” nel prompt dei permessi per saltare anche quello.',
  'folder.live': 'Letto in tempo reale dal tuo disco.',
  'folder.indexNote': 'cache di snippet e titoli, si può eliminare',
  'folder.empty': 'vuota',
  'bar.download': 'Scarica come .txt',
  'bar.theme': 'Cambia tema colore',
  'bar.font': 'Cambia carattere',
  'bar.hideMarkup': 'Nascondi la formattazione markdown',
  'bar.showMarkup': 'Mostra la formattazione markdown',
  'bar.fullscreen': 'Schermo intero',
  'img.copy': 'Copia immagine',
  'media.delete': 'Rimuovi dalla nota',
  'video.download': 'Scarica video',
  'file.open': 'Apri',
  'file.download': 'Scarica file',
  'csv.copy': 'Copia contenuto',
  'drop.image': "Rilascia l'immagine",
  'drop.video': 'Rilascia il video',
  'drop.pdf': 'Rilascia il PDF',
  'drop.csv': 'Rilascia il CSV',
  'drop.generic': 'Rilascia il file',
  'drop.formats': 'Immagini · video · PDF · CSV',
  'toast.imgCopied': 'Immagine copiata',
  'toast.copied': 'Copiato negli appunti',
  'toast.copyFail': 'Copia non riuscita',
  'toast.snippet': 'Snippet copiato',
  'toast.exported': 'JSON esportato',
  'toast.deleted': 'Eliminato',
  'lang.switch': 'English'
}

const dicts: Record<Lang, Record<string, string>> = { en, it }

/** Store of a translate function: `$t('sidebar.notes')`. */
export const t = derived(lang, (l) => (key: string): string => dicts[l][key] ?? en[key] ?? key)

function locale(l: Lang): string {
  return l === 'it' ? 'it-IT' : 'en-US'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "YYYY-MM-DD" -> "Wednesday, June 10, 2026" / "mercoledì 10 giugno 2026". */
export function formatDayFull(day: string, l: Lang): string {
  const d = new Date(day + 'T00:00:00')
  if (isNaN(d.getTime())) return day
  return capitalize(
    new Intl.DateTimeFormat(locale(l), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  )
}

/** "2026-06" -> "Giugno" / "June". */
export function formatMonth(month: string, l: Lang): string {
  const d = new Date(month + '-01T00:00:00')
  if (isNaN(d.getTime())) return month
  return capitalize(new Intl.DateTimeFormat(locale(l), { month: 'long' }).format(d))
}

/** Short day label for grouped journal lists: "Mercoledì 10" / "Wednesday 10". */
export function formatDayShort(day: string, l: Lang): string {
  const d = new Date(day + 'T00:00:00')
  if (isNaN(d.getTime())) return day
  return capitalize(new Intl.DateTimeFormat(locale(l), { weekday: 'long', day: 'numeric' }).format(d))
}

/** Shorter variant for lists: drops the year when it is the current one. */
export function formatDayList(day: string, l: Lang): string {
  const d = new Date(day + 'T00:00:00')
  if (isNaN(d.getTime())) return day
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }
  if (d.getFullYear() !== new Date().getFullYear()) options.year = 'numeric'
  return capitalize(new Intl.DateTimeFormat(locale(l), options).format(d))
}

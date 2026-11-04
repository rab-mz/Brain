import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { sideOpen, toggleFolder, openFolder, newNoteDir, openFolderDir } from './stores'

describe('one folder chain open at a time', () => {
  beforeEach(() => sideOpen.set(['month:2026-11']))

  it('opening a folder closes the others but keeps its parents', () => {
    toggleFolder('Spicchio POS')
    toggleFolder('Spicchio POS/commerciale')
    toggleFolder('Pizza Chicco')
    expect(get(sideOpen)).toEqual(['month:2026-11', 'folder:Pizza Chicco'])
    openFolder('Spicchio POS/prodotto')
    expect(get(sideOpen)).toEqual(['month:2026-11', 'folder:Spicchio POS', 'folder:Spicchio POS/prodotto'])
  })

  it('closing a folder closes its subfolders and keeps the parent open', () => {
    openFolder('Spicchio POS/prodotto')
    toggleFolder('Spicchio POS/prodotto')
    expect(get(sideOpen)).toEqual(['month:2026-11', 'folder:Spicchio POS'])
    toggleFolder('Spicchio POS')
    expect(get(sideOpen)).toEqual(['month:2026-11'])
  })

  it('new notes and folders go into the deepest open folder, never into assets', () => {
    expect(newNoteDir(['month:2026-11'])).toBe('notes')
    openFolder('Spicchio POS/commerciale')
    expect(newNoteDir(get(sideOpen))).toBe('notes/Spicchio POS/commerciale')
    openFolder('Spicchio POS/assets/marchio')
    expect(openFolderDir(get(sideOpen))).toBe('notes/Spicchio POS/assets/marchio')
    expect(newNoteDir(get(sideOpen))).toBe('notes/Spicchio POS')
  })
})

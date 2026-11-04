import { describe, it, expect } from 'vitest'
import { relativePath, relinkContent, stripReferences, resolveLink, allNotePaths, findFolder, isAssetsPath, type FolderNode } from './files'

describe('relativePath', () => {
  it('walks up and down', () => {
    expect(relativePath('notes/P/prodotto', 'notes/P/assets/a.png')).toBe('../assets/a.png')
    expect(relativePath('notes/P', 'notes/P/assets/a.png')).toBe('assets/a.png')
    expect(relativePath('notes/P/a/b', 'notes/Q/x.png')).toBe('../../../Q/x.png')
  })
})

describe('relinkContent', () => {
  it('fixes links of a note moved one level down', () => {
    const md = 'testo ![qr](assets/qr.png) e [doc](assets/a%20b.pdf) e ![w](https://x.it/a.png)'
    expect(relinkContent(md, 'notes/P', 'notes/P/prodotto')).toBe(
      'testo ![qr](../assets/qr.png) e [doc](../assets/a%20b.pdf) e ![w](https://x.it/a.png)'
    )
  })
  it('keeps links to files that moved along with the folder', () => {
    const md = '![a](assets/a.png) ![b](../assets/b.png)'
    // notes/P/sub moved to notes/Q/sub: its own assets travel, ../assets does not.
    expect(relinkContent(md, 'notes/P/sub', 'notes/Q/sub', { from: 'notes/P/sub', to: 'notes/Q/sub' })).toBe(
      '![a](assets/a.png) ![b](../../P/assets/b.png)'
    )
  })
  it('is a no-op when nothing moves', () => {
    expect(relinkContent('![a](assets/a.png)', 'notes/P', 'notes/P')).toBe('![a](assets/a.png)')
  })
})

describe('stripReferences', () => {
  it('drops the embed, and the line when it was alone', () => {
    const md = 'prima\n![x](../assets/x.png)\nriga ![x](../assets/x.png) dopo\n![y](../assets/y.png)'
    expect(stripReferences(md, 'notes/P/prodotto', 'notes/P/assets/x.png')).toBe('prima\nriga  dopo\n![y](../assets/y.png)')
  })
  it('matches encoded paths', () => {
    expect(resolveLink('notes/P', 'assets/a%20b.png')).toBe('notes/P/assets/a b.png')
  })
})

describe('tree helpers', () => {
  const tree: FolderNode = {
    name: 'notes',
    path: 'notes',
    files: ['a.md'],
    media: [],
    folders: [
      {
        name: 'P',
        path: 'notes/P',
        files: ['d.md'],
        media: [],
        folders: [{ name: 'sub', path: 'notes/P/sub', files: ['s.md'], media: ['x.png'], folders: [] }]
      }
    ]
  }
  it('lists every note at any depth', () => {
    expect(allNotePaths(tree)).toEqual(['notes/a.md', 'notes/P/d.md', 'notes/P/sub/s.md'])
  })
  it('finds nested folders', () => {
    expect(findFolder(tree, 'notes/P/sub')?.media).toEqual(['x.png'])
    expect(findFolder(tree, 'notes/Z')).toBeNull()
  })
  it('recognises assets paths', () => {
    expect(isAssetsPath('notes/P/assets/marchio')).toBe(true)
    expect(isAssetsPath('notes/P/archivio')).toBe(false)
  })
})

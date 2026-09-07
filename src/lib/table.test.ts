import { describe, expect, it } from 'vitest'
import {
  deleteColumn,
  deleteRow,
  emptyTable,
  insertColumn,
  insertRow,
  isDelimiterRow,
  parseTable,
  serializeTable,
  setAlign,
  tidyTable,
  toGrid,
  unflattenTable
} from './table'

const SIMPLE = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')

describe('parseTable', () => {
  it('reads header, alignment and body', () => {
    const t = parseTable(['| Name | Qty | Price |', '|:---|:---:|---:|', '| Pizza | 2 | 9 |'].join('\n'))!
    expect(t.cols).toBe(3)
    expect(t.align).toEqual(['left', 'center', 'right'])
    expect(toGrid(t)).toEqual([
      ['Name', 'Qty', 'Price'],
      ['Pizza', '2', '9']
    ])
  })

  it('gives every cell the offset of its text in the source', () => {
    const t = parseTable(SIMPLE)!
    const cell = t.body[0].cells[1]
    expect(SIMPLE.slice(cell.from, cell.to)).toBe('2')
    expect(t.header.cells[0].from).toBe(2)
  })

  it('keeps escaped pipes inside the cell', () => {
    const t = parseTable(['| a \\| b | c |', '|---|---|', '| 1 | 2 |'].join('\n'))!
    expect(toGrid(t)[0]).toEqual(['a \\| b', 'c'])
  })

  it('handles rows without the outer pipes and empty cells', () => {
    const t = parseTable(['a | b | c', '---|---|---', '1 || 3'].join('\n'))!
    expect(toGrid(t)).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3']
    ])
  })

  it('stops at the blank line that ends the table', () => {
    const t = parseTable([SIMPLE, '', 'prose after'].join('\n'))!
    expect(t.body).toHaveLength(1)
  })

  it('rejects text that is not a table', () => {
    expect(parseTable('| just | pipes |')).toBeNull()
    expect(parseTable(['| a | b |', 'not a delimiter', '| 1 | 2 |'].join('\n'))).toBeNull()
  })

  it('recognizes delimiter rows only', () => {
    expect(isDelimiterRow('|---|:--:|--:|')).toBe(true)
    expect(isDelimiterRow('| - a |')).toBe(false)
  })
})

describe('serializeTable', () => {
  it('pads columns to the widest cell', () => {
    const grid = [
      ['Name', 'Qty'],
      ['Margherita', '2']
    ]
    expect(serializeTable(grid, [null, null])).toBe(
      ['| Name       | Qty |', '| ---------- | --- |', '| Margherita | 2   |'].join('\n')
    )
  })

  it('writes the alignment colons and aligns the padding with them', () => {
    const out = serializeTable(
      [
        ['a', 'b', 'c'],
        ['1', '2', '3']
      ],
      ['left', 'center', 'right']
    ).split('\n')
    expect(out[1]).toBe('| :-- | :-: | --: |')
    expect(out[2]).toBe('| 1   |  2  |   3 |')
  })

  it('round-trips: tidying an already tidy table changes nothing', () => {
    const tidy = tidyTable(SIMPLE)!
    expect(tidyTable(tidy)).toBe(tidy)
  })
})

describe('structural edits', () => {
  const grid = () => [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4']
  ]

  it('inserts a row, never above the header', () => {
    expect(insertRow(grid(), 1)[1]).toEqual(['', ''])
    expect(insertRow(grid(), 0)[0]).toEqual(['a', 'b'])
  })

  it('deletes a body row but keeps the header', () => {
    expect(deleteRow(grid(), 1)).toEqual([
      ['a', 'b'],
      ['3', '4']
    ])
    expect(deleteRow([['a'], ['1']], 1)).toEqual([['a'], ['1']])
    expect(deleteRow(grid(), 0)).toEqual(grid())
  })

  it('inserts and deletes columns with their alignment', () => {
    const [g, a] = insertColumn(grid(), ['left', 'right'], 1)
    expect(g[0]).toEqual(['a', '', 'b'])
    expect(a).toEqual(['left', null, 'right'])
    expect(deleteColumn(g, a, 1)).toEqual([grid(), ['left', 'right']])
    expect(deleteColumn([['only']], [null], 0)).toEqual([[['only']], [null]])
  })

  it('sets a column alignment, growing the list if needed', () => {
    expect(setAlign([null], 2, 'center')).toEqual([null, null, 'center'])
  })
})

describe('unflattenTable', () => {
  it('rebuilds a table pasted as a single line', () => {
    const flat =
      '| # | Endpoint | Service | | --- | --- | --- | | 1 | `aziende/{id}/totali` | edoc-api | | 2 | `pdv` | pdv-api |'
    const out = unflattenTable(flat)!
    const t = parseTable(out)!
    expect(t.cols).toBe(3)
    expect(toGrid(t)).toEqual([
      ['#', 'Endpoint', 'Service'],
      ['1', '`aziende/{id}/totali`', 'edoc-api'],
      ['2', '`pdv`', 'pdv-api']
    ])
  })

  it('handles the compact |---|---| delimiter of the pasted example', () => {
    const flat = '| a | b | |---|---| | 1 | 2 |'
    expect(toGrid(parseTable(unflattenTable(flat)!)!)).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
  })

  it('leaves alone what is not a flattened table', () => {
    expect(unflattenTable('just prose')).toBeNull()
    expect(unflattenTable(SIMPLE)).toBeNull()
    expect(unflattenTable('| a | b |')).toBeNull()
  })
})

describe('emptyTable', () => {
  it('is a parseable table with the asked-for shape', () => {
    const t = parseTable(emptyTable(3, 2))!
    expect(t.cols).toBe(3)
    expect(t.body).toHaveLength(2)
  })
})

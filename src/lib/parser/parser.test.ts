import { describe, it, expect } from 'vitest'
import { parseDocument, serializeDocument, type BrainDoc } from './parser'

function roundTrip(doc: BrainDoc) {
  expect(parseDocument(serializeDocument(doc))).toEqual(doc)
}

describe('parseDocument', () => {
  it('parses frontmatter, todos, code and notes', () => {
    const md = [
      '---',
      'title: My note',
      'created: 2026-06-10T10:00:00.000Z',
      'type: note',
      '---',
      '',
      'Some intro paragraph',
      'with two lines.',
      '',
      '- [ ] buy milk',
      '- [x] ship it',
      '',
      '<!-- brain label="Top users" pinned -->',
      '```sql',
      'SELECT * FROM users;',
      '```',
      '',
      '```js',
      'console.log(1)',
      '```',
      ''
    ].join('\n')

    const doc = parseDocument(md)
    expect(doc.frontmatter).toEqual({
      title: 'My note',
      created: '2026-06-10T10:00:00.000Z',
      type: 'note'
    })
    expect(doc.blocks).toEqual([
      { type: 'note', text: 'Some intro paragraph\nwith two lines.' },
      {
        type: 'todo',
        items: [
          { done: false, text: 'buy milk' },
          { done: true, text: 'ship it' }
        ]
      },
      { type: 'code', language: 'sql', code: 'SELECT * FROM users;', label: 'Top users', pinned: true },
      { type: 'code', language: 'js', code: 'console.log(1)', label: '', pinned: false }
    ])
  })

  it('treats a brain comment without a fence as note text', () => {
    const doc = parseDocument('<!-- brain label="lost" pinned -->\njust text\n')
    expect(doc.blocks).toEqual([{ type: 'note', text: '<!-- brain label="lost" pinned -->\njust text' }])
  })

  it('does not mistake the word pinned inside a label for the pinned flag', () => {
    const doc = parseDocument('<!-- brain label="not pinned really" -->\n```sql\nSELECT 1;\n```\n')
    const block = doc.blocks[0]
    expect(block).toEqual({
      type: 'code',
      language: 'sql',
      code: 'SELECT 1;',
      label: 'not pinned really',
      pinned: false
    })
  })

  it('handles an unclosed fence gracefully', () => {
    // The trailing newline after "SELECT 1;" belongs to the (unclosed) code.
    const doc = parseDocument('```sql\nSELECT 1;\n')
    expect(doc.blocks).toEqual([
      { type: 'code', language: 'sql', code: 'SELECT 1;\n', label: '', pinned: false }
    ])
  })

  it('handles CRLF input', () => {
    const doc = parseDocument('- [ ] a\r\n- [x] b\r\n')
    expect(doc.blocks).toEqual([
      { type: 'todo', items: [{ done: false, text: 'a' }, { done: true, text: 'b' }] }
    ])
  })
})

describe('round-trip: parse(serialize(doc)) === doc', () => {
  it('round-trips a mixed document', () => {
    roundTrip({
      frontmatter: { title: 'Mixed', type: 'note', created: '2026-01-01', updated: '2026-01-02' },
      blocks: [
        { type: 'note', text: 'Hello world' },
        { type: 'todo', items: [{ done: false, text: 'one' }, { done: true, text: 'two' }] },
        { type: 'code', language: 'sql', code: 'SELECT 1;\nSELECT 2;', label: 'Queries', pinned: true },
        { type: 'note', text: 'Multi\nline\nnote' },
        { type: 'code', language: '', code: 'plain', label: '', pinned: false }
      ]
    })
  })

  it('round-trips code containing backtick fences', () => {
    roundTrip({
      frontmatter: {},
      blocks: [
        { type: 'code', language: 'md', code: 'before\n```js\ninner\n```\nafter', label: '', pinned: true }
      ]
    })
  })

  it('round-trips labels with quotes and backslashes', () => {
    roundTrip({
      frontmatter: {},
      blocks: [
        { type: 'code', language: 'sql', code: 'SELECT 1;', label: 'say "hi" \\ bye', pinned: true },
        { type: 'code', language: 'sql', code: 'SELECT 2;', label: 'pinned but not', pinned: false }
      ]
    })
  })

  it('round-trips empty and whitespace edge cases', () => {
    roundTrip({
      frontmatter: {},
      blocks: [
        { type: 'todo', items: [{ done: false, text: '' }] },
        { type: 'code', language: 'sql', code: '', label: '', pinned: true },
        { type: 'code', language: 'js', code: 'tail\n', label: '', pinned: false }
      ]
    })
  })

  it('round-trips a parsed real-world file (normalization is stable)', () => {
    const md = [
      '---',
      'title: 2026-06-10',
      'type: journal',
      '---',
      '',
      '## What happened',
      '',
      '## Notes',
      ''
    ].join('\n')
    const once = parseDocument(md)
    const twice = parseDocument(serializeDocument(once))
    expect(twice).toEqual(once)
    // And serialization is a fixed point after one pass.
    expect(serializeDocument(twice)).toBe(serializeDocument(once))
  })
})

import { describe, it, expect } from 'vitest'
import { renderInlineMarkdown } from './format'

describe('renderInlineMarkdown', () => {
  it('renders [[wiki-links]] as links carrying their target and raw offset', () => {
    const html = renderInlineMarkdown('[[fasty-diario]] i link')
    expect(html).toBe(
      '<span class="cm-wikilink" data-wiki="fasty-diario" data-r="2">fasty-diario</span><span data-r="16"> i link</span>'
    )
  })

  it('leaves [[...]] inside inline code alone', () => {
    const html = renderInlineMarkdown('see `[[x]]` here')
    expect(html).not.toContain('cm-wikilink')
    expect(html).toContain('<span class="tr-c" data-r="5">[[x]]</span>')
  })
})

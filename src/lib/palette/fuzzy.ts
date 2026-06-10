/**
 * Tiny fuzzy subsequence scorer. Returns -1 when the query does not match,
 * otherwise a score where consecutive matches and word starts rank higher.
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  if (!text) return -1
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let searchFrom = 0
  let prev = -2
  for (let i = 0; i < q.length; i++) {
    const ch = q[i]
    if (ch === ' ') {
      prev = -2
      continue
    }
    const found = t.indexOf(ch, searchFrom)
    if (found === -1) return -1
    score += 1
    if (found === prev + 1) score += 2 // consecutive run
    if (found === 0 || /[\s_\-./({[]/.test(t[found - 1])) score += 3 // word start
    prev = found
    searchFrom = found + 1
  }
  return score
}

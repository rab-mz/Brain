<script lang="ts">
  import { onMount } from 'svelte'
  import { readFile, writeFile } from './fs/files'
  import { t } from './i18n'
  import { focusOnMount } from './actions'

  let { root }: { root: FileSystemDirectoryHandle } = $props()

  const IDEAS_PATH = 'ideas/ideas.md'
  const ENTRY_RE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) — (.*)$/

  let entries: Array<{ stamp: string; text: string }> = $state([])
  let draft = $state('')
  let fileContent = ''

  function stampNow(): string {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  onMount(async () => {
    let text = await readFile(root, IDEAS_PATH)
    if (text == null) {
      text = `---\ntitle: Ideas\ntype: ideas\ncreated: ${new Date().toISOString()}\n---\n`
      await writeFile(root, IDEAS_PATH, text)
    }
    fileContent = text
    entries = text
      .split('\n')
      .map((line) => line.match(ENTRY_RE))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ stamp: m[1], text: m[2] }))
      .reverse()
  })

  // Append-only: existing entries are never rewritten by the app.
  async function add() {
    const text = draft.trim()
    if (!text) return
    const stamp = stampNow()
    if (!fileContent.endsWith('\n')) fileContent += '\n'
    fileContent += `- ${stamp} — ${text}\n`
    await writeFile(root, IDEAS_PATH, fileContent)
    entries = [{ stamp, text }, ...entries]
    draft = ''
  }
</script>

<div class="ideas">
  <h1 class="doc-title">{$t('ideas.title')}</h1>
  <input
    class="idea-input"
    use:focusOnMount
    bind:value={draft}
    placeholder={$t('ideas.ph')}
    onkeydown={(e) => {
      if (e.key === 'Enter') add()
    }}
  />
  <ul class="idea-list">
    {#each entries as entry}
      <li class="idea-entry">
        <span class="idea-stamp">{entry.stamp}</span>
        <span class="idea-text">{entry.text}</span>
      </li>
    {/each}
    {#if entries.length === 0}
      <li class="side-empty">{$t('ideas.empty')}</li>
    {/if}
  </ul>
</div>

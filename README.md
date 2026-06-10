# Brain

Local-first notes and scratchpad for developers.

- **Instant like [zen](https://zen.unit.ms)** — opens in one frame. No loading screen, no network call, no login. Ever.
- **Yours like Obsidian** — plain Markdown files in a folder you pick. The folder *is* the database. Edit the files with vim, sync them with git or Dropbox, delete the app tomorrow and lose nothing.
- **Organized like Notion, but radically simpler** — typed blocks (todos, SQL/code, text), a daily journal, an idea stream. Nothing else.

No backend. No accounts. No telemetry. MIT licensed.

## The killer feature

Pin any SQL or code block (☆ → ★), then hit **Cmd/Ctrl+K** anywhere: a palette fuzzy-searches every pinned snippet across all your notes by label and content. **Enter** copies it to the clipboard. That production query you keep digging for is now two keystrokes away.

## How it works

On first launch you pick a root folder. Brain creates:

```
your-folder/
  notes/              one Markdown file per note
  journal/            one file per day: 2026-06-10.md (auto-created)
  ideas/ideas.md      append-only idea log
  .brain/index.json   cached snippet/search index (safe to delete)
```

Every file is standard Markdown with YAML frontmatter — perfectly readable and editable in any other editor. Brain re-reads files when you come back to the tab, so external edits just work. Writes are debounced (~300 ms after you stop typing) and go straight to disk.

Blocks map to plain Markdown:

```markdown
- [ ] an open todo
- [x] a done one

<!-- brain label="Top users query" pinned -->
​```sql
SELECT * FROM users ORDER BY karma DESC LIMIT 10;
​```

Any other paragraph is a note block.
```

The snippet label and pin flag live in an HTML comment above the fence, so the file stays valid Markdown everywhere.

## Browser requirements

Brain uses the **File System Access API**, which currently ships in **Chrome and Edge** (desktop). Other browsers show a notice instead of a degraded experience. The folder permission is remembered; after a browser restart reconnecting is a single click.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl + K` | Open the snippet palette |
| `↑` `↓` / `Enter` / `Esc` | Navigate / copy / close the palette |
| `Cmd/Ctrl + N` or `Alt + N` | New note (Chrome reserves Ctrl+N for new windows — use Alt+N there) |
| `Cmd/Ctrl + J` | Jump to today's journal |
| `Enter` (in a todo) | Add a todo item below |
| `Backspace` (on an empty todo) | Remove the item |
| `Enter` (in the Ideas input) | Append a timestamped idea |

## Development

```bash
npm install
npm run dev      # start Vite dev server
npm test         # parser round-trip tests (vitest)
npm run build    # production build into dist/
```

Stack: Vite + Svelte 5 + TypeScript. No UI libraries, no CSS framework. CodeMirror 6 powers SQL/code blocks and is loaded lazily the first time a code block renders — it is not part of the initial bundle, which stays well under 100 KB gzipped. The output is a fully static site, deployable on GitHub Pages, Vercel, or any file server.

```
src/lib/fs        File System Access layer (folder handle, files, IndexedDB persistence)
src/lib/parser    Markdown <-> blocks, line-based, round-trip tested
src/lib/blocks    one Svelte component per block type + lazy CodeMirror setup
src/lib/palette   Cmd+K palette, fuzzy scorer, .brain/index.json index
src/lib/stores.ts shared Svelte stores
```

### Backup / export

Your folder is the data — copy it, `git init` it, sync it however you like. For the paranoid there is an **Export all as JSON** button in the sidebar footer that downloads every file in a single JSON document.

## License

[MIT](LICENSE)

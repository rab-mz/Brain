// Small floating context menu, shared by the note editor's media/format
// menus and the todo items. Deliberately CodeMirror-free: TodoBlock loads
// eagerly and must not pull the editor bundle in.

export function showMenu(x: number, y: number, items: Array<{ label: string; run(): void }>): void {
  const menu = document.createElement('div')
  menu.className = 'cm-image-menu'
  for (const it of items) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = it.label
    btn.onclick = () => {
      close()
      it.run()
    }
    menu.appendChild(btn)
  }
  const close = () => {
    menu.remove()
    window.removeEventListener('pointerdown', onAway, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', close)
  }
  const onAway = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  document.body.appendChild(menu)
  const r = menu.getBoundingClientRect()
  menu.style.left = Math.max(0, Math.min(x, window.innerWidth - r.width - 8)) + 'px'
  menu.style.top = Math.max(0, Math.min(y, window.innerHeight - r.height - 8)) + 'px'
  window.addEventListener('pointerdown', onAway, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', close)
}

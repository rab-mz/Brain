/** Svelte action: focus the element as soon as it mounts. */
export function focusOnMount(node: HTMLElement): void {
  node.focus()
}

/** Keep a rows=1 textarea exactly as tall as its wrapped content. */
export function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

/** Svelte action: autosize on mount and whenever the window resizes
 *  (wrapping changes with the available width). */
export function fit(el: HTMLTextAreaElement) {
  autosize(el)
  const onResize = () => autosize(el)
  window.addEventListener('resize', onResize)
  return {
    destroy() {
      window.removeEventListener('resize', onResize)
    }
  }
}

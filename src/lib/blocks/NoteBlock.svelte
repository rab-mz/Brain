<script lang="ts">
  import type { Block } from '../parser/parser'

  let { block, onedit }: { block: Extract<Block, { type: 'note' }>; onedit: () => void } = $props()

  function autosize(node: HTMLTextAreaElement) {
    const fit = () => {
      node.style.height = '0'
      node.style.height = node.scrollHeight + 'px'
    }
    fit()
    node.addEventListener('input', fit)
    return {
      destroy() {
        node.removeEventListener('input', fit)
      }
    }
  }
</script>

<textarea
  class="note-block"
  use:autosize
  value={block.text}
  placeholder="Write…"
  rows="1"
  oninput={(e) => {
    block.text = (e.target as HTMLTextAreaElement).value
    onedit()
  }}
></textarea>

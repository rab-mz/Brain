<script lang="ts">
  let { plus = false }: { plus?: boolean } = $props()
</script>

<!-- Inline SVG instead of 🗀/📁/⊞: emoji are banned from the UI, and
     U+1F5C0 has no glyph in macOS fonts (renders as horizontal bars). -->
<svg class="group-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M1.5 4.5a1.5 1.5 0 0 1 1.5-1.5h3l1.8 2h5.7a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5v-7z" />
  {#if plus}
    <path d="M8 7.5v4M6 9.5h4" />
  {/if}
</svg>

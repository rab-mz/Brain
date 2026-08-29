<script lang="ts">
  let { plus = false, open = false }: { plus?: boolean; open?: boolean } = $props()
</script>

<!-- Inline SVG instead of 🗀/📁/⊞: emoji are banned from the UI, and
     U+1F5C0 has no glyph in macOS fonts (renders as horizontal bars). -->
{#if open}
  <!-- Tilted-flap open folder: reads as "this one is expanded". -->
  <svg class="group-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path d="M1.5 11.5v-7a1.5 1.5 0 0 1 1.5-1.5h3l1.8 2h4.7a1.5 1.5 0 0 1 1.5 1.5v.5" />
    <path d="M1.5 12.5l1.9-4.1a1.5 1.5 0 0 1 1.4-.9h8.8a1 1 0 0 1 .9 1.4l-1.5 3.2a1.5 1.5 0 0 1-1.4.9H2.5a1 1 0 0 1-1-1.5z" />
  </svg>
{:else}
  <svg class="group-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
    <path d="M1.5 4.5a1.5 1.5 0 0 1 1.5-1.5h3l1.8 2h5.7a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5v-7z" />
    {#if plus}
      <path d="M8 7.5v4M6 9.5h4" />
    {/if}
  </svg>
{/if}

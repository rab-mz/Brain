<script lang="ts">
  let {
    oninsert,
    always = false
  }: { oninsert: (kind: 'note' | 'todo' | 'code' | 'sql') => void; always?: boolean } = $props()

  let open = $state(false)

  const kinds: Array<['note' | 'todo' | 'code' | 'sql', string]> = [
    ['note', 'Note'],
    ['todo', 'Todo'],
    ['sql', 'SQL'],
    ['code', 'Code']
  ]
</script>

<div class="insert-point" class:always>
  {#if open}
    <div class="insert-menu">
      {#each kinds as [kind, label]}
        <button
          onclick={() => {
            open = false
            oninsert(kind)
          }}
        >
          {label}
        </button>
      {/each}
      <button class="insert-cancel" onclick={() => (open = false)}>×</button>
    </div>
  {:else}
    <button class="insert-btn" title="Insert block" onclick={() => (open = true)}>+</button>
  {/if}
</div>

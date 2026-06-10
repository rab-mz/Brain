<script lang="ts">
  let {
    title,
    message,
    confirmLabel,
    cancelLabel,
    onconfirm,
    oncancel
  }: {
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
    onconfirm: () => void
    oncancel: () => void
  } = $props()

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      oncancel()
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={oncancel}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <h3 class="modal-title">{title}</h3>
    <p class="modal-message">{message}</p>
    <div class="modal-actions">
      <button class="modal-cancel" onclick={oncancel}>{cancelLabel}</button>
      <button class="modal-danger" onclick={onconfirm}>{confirmLabel}</button>
    </div>
  </div>
</div>

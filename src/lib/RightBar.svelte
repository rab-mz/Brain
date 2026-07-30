<script lang="ts">
  import { t } from './i18n'
  import { hideMarkup } from './stores'

  let {
    ondownload,
    oncycletheme,
    oncyclefont,
    onfullscreen
  }: {
    ondownload: () => void
    oncycletheme: () => void
    oncyclefont: () => void
    onfullscreen: () => void
  } = $props()
</script>

<div class="right-bar">
  <button data-tip={$t('bar.download')} onclick={ondownload}>⤓</button>
  <button data-tip={$t('bar.theme')} onclick={oncycletheme}>◑</button>
  <button class="font-btn" data-tip={$t('bar.font')} onclick={oncyclefont}>A</button>
  <button
    class="markup-btn"
    class:on={$hideMarkup}
    data-tip={$t($hideMarkup ? 'bar.showMarkup' : 'bar.hideMarkup')}
    onclick={() => hideMarkup.update((v) => !v)}>#</button
  >
  <button data-tip={$t('bar.fullscreen')} onclick={onfullscreen}>⛶</button>
</div>

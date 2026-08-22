<script lang="ts">
  // the game surface plus the shared shell chrome. the canvas is the play surface,
  // the chrome is DOM on the house shell, and both paint from the theme tokens.
  import Game from '$lib/Game.svelte'
  import Shell from '$lib/Shell.svelte'
  import { loadSave } from '../save'
  import type { GameApi } from '$lib/api'

  // the start card's one line of context, same rule as the vanilla build
  const save = loadSave()
  const startStats = save.lifetime === 0
    ? 'a tiny mining game'
    : `mine ${save.mine + 1} · ${save.coins} · ${save.lifetime} lifetime`

  let paused = $state(true) // the start card owns boot, PLAY unpauses
  let muted = $state(false)
  // these three are bound OUT of Game and handed INTO Shell. declaring them on both
  // components without connecting them here is exactly how the reset-arming and the
  // nav inset shipped as dead code: the props existed, nothing ever called them.
  let toggleMute: (() => void) | undefined = $state()
  let beginReset: (() => void) | undefined = $state()
  let onplay: ((navHeight: number) => void) | undefined = $state()
  let measureNav: ((navHeight: number) => void) | undefined = $state()
  let api: GameApi | undefined = $state()
</script>

<svelte:head><title>Quarry</title></svelte:head>

<main>
  <Game bind:paused bind:muted bind:toggleMute bind:beginReset bind:onplay bind:measureNav bind:api />
  <Shell
    bind:paused
    bind:muted
    {startStats}
    onmute={() => toggleMute?.()}
    onplay={height => onplay?.(height)}
    measureNav={height => measureNav?.(height)}
    beginReset={() => beginReset?.()}
    {api}
  />
</main>

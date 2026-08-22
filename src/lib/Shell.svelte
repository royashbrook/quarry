<script lang="ts">
  // the DOM chrome, ported off index.html + main.ts. structure and class names are
  // kept EXACTLY as they were (#play-button, #bottom-nav, .sheet, #about-dialog and
  // friends), because the e2e suite and the house checker both address them by id and
  // the standard's compliance bar is "structure fixed, look swappable". everything
  // here paints from the shell theme tokens.
  import { version } from '$app/environment'
  import { updated } from '$app/state'
  import Sheets from './Sheets.svelte'
  import type { GameApi } from './api'

  let {
    paused = $bindable(true),
    audioState = 'none',
    muted = $bindable(false),
    onmute,
    onplay,
    measureNav,
    beginReset,
    api,
    startStats = '',
  }: {
    paused?: boolean
    audioState?: string
    muted?: boolean
    onmute?: () => void
    onplay?: (navHeight: number) => void
    measureNav?: (navHeight: number) => void
    beginReset?: () => void
    api?: GameApi
    startStats?: string
  } = $props()

  let started = $state(false)
  let sheet: 'shop' | 'stats' | 'settings' | null = $state(null)
  let aboutOpen = $state(false)
  let aboutEl: HTMLDialogElement | undefined = $state()
  let resetArmed = $state(false)
  let updateLabel = $state('↻ CHECK FOR UPDATES')
  let updateReady = $state(false)
  let navEl: HTMLElement | undefined = $state()
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  function play(): void {
    started = true
    paused = false
    // hand the renderer the nav height AFTER it exists, or the world draws under the
    // bar. one frame is enough for the nav to lay out.
    requestAnimationFrame(() => onplay?.(navEl?.offsetHeight ?? 0))
  }

  function remeasure(): void {
    measureNav?.(navEl?.offsetHeight ?? 0)
  }

  // the nav height is NOT one-shot: main.ts remeasured on every resize, because the
  // bar's height moves with rotation, a url bar collapsing, or a safe-area change.
  // measuring only at PLAY leaves the world drawn under the bar for the rest of the run.
  $effect(() => {
    const onResize = () => requestAnimationFrame(remeasure)
    addEventListener('resize', onResize)
    return () => {
      removeEventListener('resize', onResize)
      clearTimeout(idleTimer) // the label timeout must not outlive the component
    }
  })

  // move focus into the sheet when it opens, so a keyboard or screen-reader player
  // lands on the thing that just appeared instead of staying behind it
  function focusOnOpen(node: HTMLElement) {
    node.focus()
  }

  function toggleSheet(name: 'shop' | 'stats' | 'settings'): void {
    sheet = sheet === name ? null : name
  }

  // a real modal: showModal() gives :modal, the focus trap, Escape, and focus
  // restore to the opener. `<dialog open>` gives none of that.
  $effect(() => {
    if (!aboutEl) return
    if (aboutOpen && !aboutEl.open) aboutEl.showModal()
    if (!aboutOpen && aboutEl.open) aboutEl.close()
  })

  async function checkUpdates(): Promise<void> {
    // once an update is found the button IS the reload. re-probing instead would leave
    // the player tapping "TAP TO RELOAD" forever while nothing reloads.
    if (updateReady) { location.reload(); return }
    updateLabel = '↻ CHECKING…'
    // kit's own probe against the DEPLOYED version manifest: honest by construction,
    // unlike comparing a fetch to the shell we already booted with
    const found = await updated.check()
    updateReady = found
    updateLabel = found ? '↻ UPDATE READY, TAP TO RELOAD' : '✓ UP TO DATE'
    if (!found) {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { updateLabel = '↻ CHECK FOR UPDATES' }, 2500)
    }
  }

  function resetAll(): void {
    if (!resetArmed) { resetArmed = true; return }
    // ARM FIRST. the loop autosaves every second and pagehide saves on unload, so
    // wiping storage while the game can still write just resurrects the save.
    beginReset?.()
    localStorage.removeItem('quarry_save_v1')
    location.reload()
  }
</script>

{#if updated.current}
  <button class="round-button update-toast" aria-label="Update ready, tap to refresh" onclick={() => location.reload()}>↻</button>
{/if}

{#if !started}
  <div id="start-card" class="sheet-card start" role="dialog" aria-label="Quarry start menu">
    <img src="./icon.svg" alt="" width="96" height="96" />
    <h1>QUARRY</h1>
    <p id="start-stats">{startStats}</p>
    <button id="play-button" class="big-button" onclick={play}>PLAY</button>
    <button id="about-open" class="round-button about-button" aria-label="About" onclick={() => (aboutOpen = true)}>ABOUT</button>
  </div>
{:else}
  <nav id="bottom-nav" bind:this={navEl} aria-label="Game menu">
    <button data-sheet="shop" data-active={sheet === 'shop' ? '' : undefined} aria-label="Open shop" onclick={() => toggleSheet('shop')}>⛏ SHOP</button>
    <button data-sheet="stats" data-active={sheet === 'stats' ? '' : undefined} aria-label="Open stats" onclick={() => toggleSheet('stats')}>📊 STATS</button>
    <button data-sheet="settings" data-active={sheet === 'settings' ? '' : undefined} aria-label="Open settings" onclick={() => toggleSheet('settings')}>⚙ MORE</button>
  </nav>
{/if}

{#if sheet}
  <div id="sheet-backdrop" onclick={() => (sheet = null)} role="presentation"></div>
{/if}

{#if sheet === 'shop' || sheet === 'stats'}
  <Sheets which={sheet} {api} onclose={() => (sheet = null)} />
{/if}

{#if sheet === 'settings'}
  <!-- a div, not a section: section carries an implicit landmark role, so putting
       role="dialog" on it is a conflict. div is generic, and tabindex lets focus land
       in the sheet instead of behind it. id + class are unchanged, so the e2e suite
       and the house checker still address it exactly as before. -->
  <!-- NO aria-modal: nothing behind this is inert and focus is not trapped, so
       claiming modal would lie to a screen reader. it is a dialog-role sheet that
       takes focus on open (the action below), which is what it actually is. -->
  <div id="sheet-settings" class="sheet" role="dialog" aria-label="Settings" tabindex="-1" use:focusOnOpen>
    <h2>MORE</h2>
    <div class="settings-row">
      <button id="mute-button" class="mute-button" aria-label="Toggle sound" aria-pressed={!muted} onclick={() => onmute?.()}>
        {muted ? '🔇' : '🔊'} SOUND
      </button>
      <button id="check-updates" aria-label="Check for updates" onclick={checkUpdates}>{updateLabel}</button>
      <button id="reset-save2" aria-label="Reset all progress" class="danger-row" data-armed={resetArmed ? '' : undefined} onclick={resetAll}>
        {resetArmed ? '!? SURE? TAP AGAIN' : '🗑 RESET ALL'}
      </button>
      <button id="about-open2" aria-label="About" onclick={() => (aboutOpen = true)}>🧡 ABOUT</button>
    </div>
    <p class="version-stamp">v{version}</p>
  </div>
{/if}

<!-- the about block: house standard section 3 slot 5, with the real maker's mark -->
<dialog id="about-dialog" bind:this={aboutEl} aria-labelledby="about-title" onclose={() => (aboutOpen = false)}>
  <form method="dialog"><button class="close" aria-label="Close">×</button></form>
  <h2 id="about-title">ABOUT QUARRY</h2>
  <p class="about-body">mine rocks, fill your pack, sell them, upgrade your gear, and dig
  deeper. a whole quarry to work through, one swing at a time.</p>
  <p class="about-ethos">no ads, no lives, no timers, nothing to buy, no accounts, no
  cookies, nothing sold or shared. that is the whole point.</p>
  <p class="about maker-mark">
    made with <svg aria-hidden="true" class="mark-heart" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg><span class="sr">love</span> by
    <a href="https://royashbrook.com" target="_blank" rel="noreferrer">roy</a> +
    <a href="https://royashbrook.com/agents/" target="_blank" rel="noreferrer">ai</a>
    <span aria-hidden="true" class="mark-dot">·</span>
    <a href="https://github.com/royashbrook/quarry" target="_blank" rel="noreferrer">source</a>
    <span aria-hidden="true" class="mark-dot">·</span>
    <a href="https://github.com/sponsors/royashbrook" target="_blank" rel="noreferrer" class="mark-sponsor">sponsor me</a>
  </p>
</dialog>

<style>
  /* the version stamp: the house standard's slot, painted from tokens */
  .version-stamp { margin: .6rem 0 0; color: var(--ink-dim); font-size: .75rem; text-align: center; }
</style>

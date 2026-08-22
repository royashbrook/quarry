<script lang="ts">
  import { createGame, runFor, step, WORLD, type GameState, type Point } from '../engine'
  import { Controls } from '../input'
  import { Renderer } from '../render'
  import { loadSave, storeSave } from '../save'
  import { backingSize, computeViewport, VIEW, type Viewport } from '../viewport'
  import { Audio } from './audio'
  import type { QuarryHooks } from '../app.d.ts'
  import { buyUpgrade, hireHelperNow, prestigeNow, type GameApi } from './api'

  // paused is the shell's to drive (the start card owns boot, PLAY unpauses). the
  // test hook can also drive it, which is why it is plain state and not derived.
  // muted + toggleMute are bound OUT to the shell: the synth belongs to the game's
  // lifecycle (it dies with the canvas), the button that flips it belongs to the chrome.
  let {
    paused = $bindable(false),
    muted = $bindable(false),
    toggleMute = $bindable(),
    beginReset = $bindable(),
    onplay = $bindable(),
    measureNav = $bindable(),
    api = $bindable(),
  }: {
    paused?: boolean
    muted?: boolean
    toggleMute?: () => void
    // armed by the chrome BEFORE it wipes the save: once fired, nothing may write the
    // save again, or the running loop (and pagehide) rewrites the file we just deleted
    beginReset?: () => void
    // PLAY hands back the two things the renderer needs: the nav's height, and the
    // coached first-run beats
    onplay?: (navHeight: number) => void
    // resize-safe: moves the inset only, never touches the coach
    measureNav?: (navHeight: number) => void
    /** the narrow surface the chrome drives the engine through. the shell never gets
     *  the live state object: it reads snapshots and calls actions. */
    api?: GameApi
  } = $props()

  let canvas: HTMLCanvasElement
  const state: GameState = createGame(loadSave())
  let viewport: Viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio)
  let cameraY = 0
  let resetting = false
  let coachOrigin: Point | null = null

  // the camera follows the miner DOWN the dig, eased, clamped to the world
  function updateCamera(dt: number): void {
    const target = Math.max(0, Math.min(
      state.player.y - VIEW.height * 0.45,
      WORLD.height - viewport.viewHeight + (viewport.viewHeight - VIEW.height) / 2,
    ))
    cameraY += (target - cameraY) * Math.min(1, dt * 6)
  }

  // ONE effect owns the whole runtime: renderer, controls, audio, the loop, and the
  // test hook. everything it starts, it stops. a leaked frame or listener is invisible
  // until a remount doubles it, so teardown here is total by construction.
  $effect(() => {
    if (!canvas) return

    const audio = new Audio()
    muted = audio.muted
    toggleMute = () => { muted = audio.toggleMute() }
    const controls = new Controls(canvas, () => viewport, () => cameraY)
    const renderer = new Renderer(canvas)
    renderer.audioState = () => audio.hudState() // the player-facing readout, not the raw one

    // arm the reset: from here the loop and pagehide must never write again, or they
    // resurrect the save the chrome is about to delete
    beginReset = () => { resetting = true }

    api = {
      snapshot: () => structuredClone(state),
      buy: id => { buyUpgrade(state, id); storeSave(state.save) },
      hire: () => { hireHelperNow(state); storeSave(state.save) },
      prestige: () => { const ok = prestigeNow(state); if (ok) storeSave(state.save); return ok },
    }

    // TWO callbacks, not one. measuring the nav happens on every resize, but starting
    // the coach must happen ONCE at PLAY: my first version had resize call onplay, so
    // every rotation restarted the tutorial mid-run (and re-anchored coachOrigin to
    // wherever the player currently stood).
    measureNav = (navHeight: number) => { renderer.bottomInset = navHeight }

    onplay = (navHeight: number) => {
      renderer.bottomInset = navHeight
      // the two coached beats on a fresh save (move, then mine). never again once
      // lifetime coins exist.
      if (state.save.lifetime === 0) {
        renderer.coachStep = 'move'
        coachOrigin = { x: state.player.x, y: state.player.y }
      }
    }

    function fitViewport(): void {
      viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio)
      const backing = backingSize(viewport)
      if (canvas.width !== backing.width) canvas.width = backing.width
      if (canvas.height !== backing.height) canvas.height = backing.height
    }
    fitViewport()

    const ac = new AbortController()
    addEventListener('resize', fitViewport, { signal: ac.signal })
    addEventListener('pagehide', () => { if (!resetting) storeSave(state.save) }, { signal: ac.signal })
    const ro = new ResizeObserver(fitViewport)
    ro.observe(document.body)

    // the canvas HUD caches its resolved tokens, so SOMETHING has to tell it the theme
    // moved. watching data-theme on the root is that caller: without it refreshTokens
    // was dead code and the HUD kept the palette it booted with.
    const themeWatch = new MutationObserver(() => renderer.refreshTokens())
    themeWatch.observe(document.documentElement, { attributeFilter: ['data-theme', 'style'] })

    // the RAF LEDGER: every reschedule overwrites this, so teardown cancels the LIVE
    // frame. keeping only the first id would cancel a long-dead one and leak the loop.
    let rafId = 0
    // the wall-clock baseline. it advances on EVERY frame, including paused ones, so
    // resuming never replays the paused span as one giant catch-up step. pause gates
    // the simulation, it does not stop the clock.
    let previous = performance.now()
    let saveClock = 0

    function frame(now: number): void {
      rafId = requestAnimationFrame(frame)
      const elapsed = Math.min(0.05, (now - previous) / 1000)
      previous = now
      if (!paused) {
        step(state, elapsed, controls.vector)
        updateCamera(elapsed)
      }
      // the coached beats advance on the real action: walk far enough, then mine
      if (renderer.coachStep === 'move' && coachOrigin
        && Math.hypot(state.player.x - coachOrigin.x, state.player.y - coachOrigin.y) > 60) renderer.coachStep = 'mine'
      if (renderer.coachStep === 'mine' && state.stack.length > 0) renderer.coachStep = null
      state.pings.splice(0).forEach(ping => audio.bleep(ping)) // drain feel events even while paused
      audio.idleCheck()
      renderer.draw(state, controls.joystick, viewport, cameraY)
      // the autosave is NOT pause-gated, exactly as main.ts had it. gating it looked
      // tidy and quietly changed persistence: advance() mutates state while paused by
      // design (it is the deterministic clock), so a pause gate means that progress
      // never reaches storage. the pause gates the SIMULATION, never the save.
      saveClock += elapsed
      if (saveClock >= 1 && !resetting) {
        saveClock = 0
        storeSave(state.save)
      }
    }
    rafId = requestAnimationFrame(frame)

    // the hook the e2e suite drives. never in a production bundle.
    let installed: QuarryHooks | undefined
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
      installed = {
        // the engine's state is a plain object (not runes state), so a structured
        // clone IS the snapshot. no $state.snapshot: it would also read as store
        // auto-subscription against the local `state` binding.
        snapshot: () => structuredClone(state),
        movePlayer: point => { state.player.x = point.x; state.player.y = point.y },
        // advance drives SIMULATION time directly and works while paused: it is the
        // deterministic clock, independent of the wall-clock RAF delta above.
        advance: (seconds: number, input?: Point) => runFor(state, seconds, input),
        viewport: () => ({ ...viewport }),
        cameraY: () => cameraY,
        joystickOrigin: () => (controls.joystick.active ? { ...controls.joystick.origin } : null),
        pause: (on: boolean) => { paused = on },
        setTime: (seconds: number) => { state.time = seconds }, // simulation time only
        audioState: () => audio.state(),
        coachStep: () => renderer.coachStep,
        bottomInset: () => renderer.bottomInset,
        forceAudioIdle: () => audio.forceIdle(),
      }
      window.__quarry = installed
      // deterministic readiness: vanilla installed the hook synchronously on module
      // load, svelte installs it after mount, so a spec that evaluates right after
      // goto() could race it. tests wait on this flag instead of a sleep.
      document.documentElement.dataset.ready = '1'
    }

    return () => {
      cancelAnimationFrame(rafId)
      controls.destroy()
      audio.destroy()
      ro.disconnect()
      themeWatch.disconnect()
      ac.abort()
      // identity-safe: only clear the hook THIS mount installed, so a remount that
      // already installed its own is never clobbered by the old mount's teardown.
      // the cast is the delete's narrowing (see app.d.ts): optional-on-Window would
      // make every spec's window.__quarry.foo() possibly-undefined for this one line.
      // BOTH markers behind the SAME identity guard. deleting data-ready
      // unconditionally meant a stale teardown could strip the readiness flag off a
      // NEW mount while correctly leaving that mount's hook in place, which is a worse
      // race than the one it was added to fix.
      if (installed && window.__quarry === installed) delete document.documentElement.dataset.ready
      if (installed && window.__quarry === installed) {
        delete (window as unknown as { __quarry?: QuarryHooks }).__quarry
      }
    }
  })
</script>

<canvas id="game" bind:this={canvas} aria-label="the quarry"></canvas>

<style>
  #game { display: block; width: 100%; height: 100dvh; touch-action: none; }
</style>

// the tiny synth, lifted out of main.ts unchanged in behaviour and given an owner.
//
// a game, not a music app: the ambient category mixes with the player's own audio and
// respects the ringer switch, which is how well-behaved ios games sound. the context
// also suspends itself after idle so the system audio indicator drops when nothing bleeps.
//
// why it is a class now: the svelte shell mounts and unmounts the game, and an
// AudioContext plus its two wake listeners are exactly the kind of thing that survives
// an unmount and leaks. destroy() closes the context and drops every listener.

const MUTE_KEY = 'quarry_mute'

const TONES: Record<string, [number, number, OscillatorType]> = {
  swing: [180, 0.05, 'square'],
  break: [90, 0.16, 'sawtooth'],
  coin: [880, 0.07, 'sine'],
  buy: [520, 0.12, 'triangle'],
  gate: [130, 0.4, 'sawtooth'],
  contract: [660, 0.3, 'triangle'],
}

export class Audio {
  muted = localStorage.getItem(MUTE_KEY) === '1'
  private ctx: AudioContext | null = null
  private lastBleepAt = 0
  private idleSuspended = false
  private ac = new AbortController()

  constructor() {
    const signal = this.ac.signal
    const wake = (): void => this.wake()
    // the context can only be created inside a gesture (autoplay policy)
    addEventListener('pointerdown', wake, { signal })
    addEventListener('keydown', wake, { signal })
    // route this through wake() like every other path. calling ctx.resume() directly
    // left idleSuspended set and lastBleepAt stale, so coming back to a visible tab
    // resumed into stale state and was immediately eligible to suspend again.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.wake(true)
    }, { signal })
  }

  private wake(existingOnly = false): void {
    if (!this.ctx) {
      if (existingOnly) return // a tab becoming visible is not a gesture
      this.ctx = new AudioContext()
      const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'ambient'
    }
    if (this.ctx.state === 'suspended') {
      this.idleSuspended = false
      void this.ctx.resume()
    }
    // a wake restarts the idle clock. keeping the old lastBleepAt meant a context
    // woken after a long silence was immediately eligible for re-suspension, so the
    // probe could still read idle right after a real pointer wake.
    this.lastBleepAt = performance.now()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    return this.muted
  }

  /** test-only: force the idle-suspended state so a spec can prove the wake repair
   *  without burning 15 real seconds of wall clock. */
  forceIdle(): void {
    this.idleSuspended = true
    // age the clock too. setting only the flag modelled half the bug: the real idle
    // state is "suspended AND last bleep was long ago", and a wake has to repair BOTH.
    // without this the stale-clock regression passes the test.
    this.lastBleepAt = performance.now() - 60000
    void this.ctx?.suspend()
  }

  // drop the system "playing" indicator when nothing has bleeped for a while
  idleCheck(): void {
    const ctx = this.ctx
    if (ctx && ctx.state === 'running' && performance.now() - this.lastBleepAt > 15000) {
      this.idleSuspended = true
      void ctx.suspend()
    }
  }

  bleep(kind: string): void {
    const ctx = this.ctx
    if (this.muted || !ctx || ctx.state !== 'running') return
    this.lastBleepAt = performance.now()
    const [freq, seconds, shape] = TONES[kind] ?? TONES.coin
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = shape
    osc.frequency.value = freq
    if (kind === 'gate' || kind === 'contract') osc.frequency.exponentialRampToValueAtTime(freq * 2, ctx.currentTime + seconds)
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + seconds)
  }

  // TWO readouts on purpose, exactly as main.ts had them, because they answer
  // different questions and collapsing them into one was a regression:
  //
  //   hudState(): "can this player hear the game?" idle-suspension is invisible to a
  //     player (the next bleep resumes it), so it reads RUNNING. reading 'idle' here
  //     put "TAP FOR SOUND" on screen while sound was perfectly fine.
  //   state(): "what is the context actually doing?" the test hook wants the truth,
  //     including idle suspension.
  hudState(): string {
    return this.muted ? 'muted' : this.idleSuspended ? 'running' : this.ctx?.state ?? 'none'
  }

  state(): string {
    return this.muted ? 'muted' : this.idleSuspended ? 'idle' : this.ctx?.state ?? 'none'
  }

  destroy(): void {
    this.ac.abort()
    void this.ctx?.close().catch(() => {})
    this.ctx = null
  }
}

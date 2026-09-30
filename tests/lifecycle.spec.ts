import { expect, test, type Page } from '@playwright/test'
import { ready } from './ready'

// the same-document mount -> unmount -> remount proof. every other spec reloads the
// page, and a reload cannot see a loop, listener, timer or observer leaked WITHIN one
// document: the navigation throws the whole document away. this spec tears the app
// down and brings it back in the same document (+layout.svelte's test-only hook) and
// asserts the observable old/new-instance contract from docs/svelte-conversion.md:
//
//   1. the old hook's clock FREEZES the moment its mount is gone (the loop that fed
//      it is dead), and the global is cleared
//   2. the remount installs a DISTINCT hook whose clock ADVANCES, while the old one
//      stays stopped
//   3. exactly one live animation loop after the remount, and zero frames, timers,
//      listeners or observers left behind by an unmounted generation
//
// the instrument is a ledger installed before any page script: it wraps
// requestAnimationFrame, the timer functions, EventTarget listeners and the two
// observers, tagging each with a generation the test bumps between mounts. the first
// mount shares generation 0 with kit's own setup, so generation 1 (the remount) is
// where "left behind" is an absolute zero, and totals must return to the same floor
// after every unmount.

type Live = {
  frames: number[]
  timers: { gen: number; kind: string; ms: number }[]
  listeners: { gen: number; type: string; target: string }[]
  observers: { gen: number; kind: string }[]
}

declare global {
  interface Window {
    __ledger: { gen: number; snapshot: () => Live }
    __old: Window['__quarry']
  }
}

function installLedger(): void {
  type Listener = {
    target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; capture: boolean
    gen: number; wrapped: EventListenerOrEventListenerObject
  }
  type Observer = { gen: number; kind: string; live: boolean }
  const frames = new Map<number, number>()
  const timers = new Map<number, { gen: number; kind: string; ms: number }>()
  const listeners = new Set<Listener>()
  const observers = new Set<Observer>()
  // two things are deliberately outside the ledger's remit:
  //   - kit's deploy poll (svelte.config.js pollInterval, 300s) is process-wide and
  //     re-armed by every updated.check(); no mount owns it, so a check made during
  //     one generation must not read as that generation's leak
  //   - a listener on a node that is no longer in the document. svelte 5 removes
  //     window/document/body listeners on teardown and lets element-local ones die
  //     with their node; only this ledger's own reference keeps such a node alive,
  //     and nothing can dispatch to it, so it is not a listener that keeps running
  const KIT_POLL = 60000
  const attached = (target: EventTarget) => !(target instanceof Node) || target.isConnected
  const ledger = { gen: 0, snapshot: (): Live => ({
    frames: [...frames.values()],
    timers: [...timers.values()].filter(t => t.ms < KIT_POLL),
    listeners: [...listeners].filter(entry => attached(entry.target))
      .map(entry => ({ gen: entry.gen, type: entry.type, target: label(entry.target) })),
    observers: [...observers].filter(o => o.live).map(o => ({ gen: o.gen, kind: o.kind })),
  }) }
  window.__ledger = ledger

  function label(target: EventTarget): string {
    if (target === window) return 'window'
    if (target === document) return 'document'
    if (target instanceof Element) return target.id ? `${target.tagName.toLowerCase()}#${target.id}` : target.tagName.toLowerCase()
    return target.constructor.name
  }

  const raf = window.requestAnimationFrame
  const caf = window.cancelAnimationFrame
  window.requestAnimationFrame = callback => {
    const id: number = raf.call(window, (time: number) => { frames.delete(id); callback(time) })
    frames.set(id, ledger.gen)
    return id
  }
  window.cancelAnimationFrame = id => { frames.delete(id); caf.call(window, id) }

  // the browser signatures, not the node ones the type merge would otherwise pick
  type Schedule = (fn: TimerHandler, ms?: number) => number
  type Clear = (id: number | undefined) => void
  const setT = window.setTimeout.bind(window) as unknown as Schedule
  const setI = window.setInterval.bind(window) as unknown as Schedule
  const clearT = window.clearTimeout.bind(window) as unknown as Clear
  const clearI = window.clearInterval.bind(window) as unknown as Clear
  window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (typeof fn !== 'function') return setT(fn, ms)
    const id = setT(() => { timers.delete(id); fn(...args) }, ms)
    timers.set(id, { gen: ledger.gen, kind: 'timeout', ms: ms ?? 0 })
    return id
  }) as typeof window.setTimeout
  window.setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (typeof fn !== 'function') return setI(fn, ms)
    const id = setI(() => fn(...args), ms)
    timers.set(id, { gen: ledger.gen, kind: 'interval', ms: ms ?? 0 })
    return id
  }) as typeof window.setInterval
  window.clearTimeout = ((id?: number) => { if (id !== undefined) timers.delete(id); clearT(id) }) as typeof window.clearTimeout
  window.clearInterval = ((id?: number) => { if (id !== undefined) timers.delete(id); clearI(id) }) as typeof window.clearInterval

  const add = EventTarget.prototype.addEventListener
  const remove = EventTarget.prototype.removeEventListener
  const captureOf = (options?: boolean | AddEventListenerOptions) =>
    typeof options === 'boolean' ? options : Boolean(options?.capture)
  const find = (target: EventTarget, type: string, fn: EventListenerOrEventListenerObject, capture: boolean) => {
    for (const entry of listeners) {
      if (entry.target === target && entry.type === type && entry.fn === fn && entry.capture === capture) return entry
    }
    return undefined
  }
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    if (!fn) return add.call(this, type, fn, options)
    const capture = captureOf(options)
    const signal = typeof options === 'object' ? options.signal : undefined
    // the DOM ignores a duplicate registration and refuses an already-aborted signal:
    // the ledger does the same, or it would count listeners that never attached
    if (find(this, type, fn, capture) || signal?.aborted) return add.call(this, type, fn, options)
    const entry: Listener = { target: this, type, fn, capture, gen: ledger.gen, wrapped: fn }
    if (typeof options === 'object' && options.once) {
      entry.wrapped = function (this: EventTarget, event: Event) {
        listeners.delete(entry)
        return typeof fn === 'function' ? fn.call(this, event) : fn.handleEvent(event)
      }
    }
    listeners.add(entry)
    // an AbortSignal removal never goes through removeEventListener, so watch the signal
    if (signal) add.call(signal, 'abort', () => listeners.delete(entry), { once: true })
    return add.call(this, type, entry.wrapped, options)
  }
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    const entry = fn ? find(this, type, fn, captureOf(options)) : undefined
    if (!entry) return remove.call(this, type, fn, options)
    listeners.delete(entry)
    return remove.call(this, type, entry.wrapped, options)
  }

  interface Observing { observe(...args: unknown[]): void; disconnect(): void }
  for (const kind of ['ResizeObserver', 'MutationObserver'] as const) {
    const Native = window[kind] as unknown as new (callback: never) => Observing
    ;(window as unknown as Record<string, unknown>)[kind] = class extends Native {
      private entry: Observer
      constructor(callback: never) {
        super(callback)
        this.entry = { gen: ledger.gen, kind, live: false }
        observers.add(this.entry)
      }
      override observe(...args: unknown[]) { this.entry.live = true; return super.observe(...args) }
      override disconnect() { this.entry.live = false; return super.disconnect() }
    }
  }
}

// the game's own shape, and a third of the pixels: headless chromium paints this canvas
// in software and the frame cost scales with the viewport (at 1280x720 the loop runs
// near 4fps here, and every click then waits seconds for two stable frames)
test.use({ viewport: { width: 390, height: 844 } })

const live = (page: Page) => page.evaluate(() => window.__ledger.snapshot())
const ofGen = (state: Live, gen: number) => ({
  frames: state.frames.filter(g => g === gen).length,
  timers: state.timers.filter(t => t.gen === gen),
  listeners: state.listeners.filter(l => l.gen === gen),
  observers: state.observers.filter(o => o.gen === gen),
})
const totals = (state: Live) => ({
  frames: state.frames.length, timers: state.timers.length,
  listeners: state.listeners.length, observers: state.observers.length,
})
const clock = (page: Page) => page.evaluate(() => window.__quarry.snapshot().time)
const oldClock = (page: Page) => page.evaluate(() => window.__old.snapshot().time)

test('unmount stops everything the mount started, remount owns exactly one run', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(installLedger)
  await page.goto('/')
  await ready(page)
  await page.waitForFunction(() => Boolean(window.__quarryLifecycle))

  // mount 1: play, so the loop is really simulating (a paused loop freezes the clock
  // on its own and would prove nothing), and keep its hook as the OLD instance
  await page.click('#play-button')
  await page.evaluate(() => { window.__old = window.__quarry })
  const started = await clock(page)
  await expect.poll(() => clock(page)).toBeGreaterThan(started)
  // an open sheet holds a live interval, which the unmount must clear with the rest
  await page.click('[data-sheet="shop"]')
  await expect(page.locator('#sheet-shop')).toBeVisible()
  expect(await live(page).then(s => s.timers.some(t => t.kind === 'interval' && t.ms === 500))).toBe(true)

  // unmount 1
  await page.evaluate(() => window.__quarryLifecycle.unmount())
  await expect(page.locator('canvas')).toHaveCount(0)
  expect(await page.evaluate(() => typeof window.__quarry)).toBe('undefined')
  expect(await page.evaluate(() => document.documentElement.dataset.ready)).toBeUndefined()
  const frozen = await oldClock(page)
  await page.waitForTimeout(300)
  expect(await oldClock(page)).toBe(frozen) // the loop that fed the old hook is dead
  const floor = await live(page)
  expect(totals(floor).frames).toBe(0) // the game owns the only animation loop
  expect(floor.timers.filter(t => t.kind === 'interval' && t.ms === 500)).toEqual([])

  // remount, as generation 1: everything this mount registers carries that tag
  await page.evaluate(() => { window.__ledger.gen = 1; window.__quarryLifecycle.mount() })
  await ready(page)
  expect(await page.evaluate(() => window.__quarry !== window.__old)).toBe(true)
  await page.click('#play-button')
  const restarted = await clock(page)
  await expect.poll(() => clock(page)).toBeGreaterThan(restarted)
  expect(await oldClock(page)).toBe(frozen) // the retained old instance stays stopped
  await expect.poll(() => live(page).then(totals)).toMatchObject({ frames: 1 }) // exactly one loop
  const mounted = ofGen(await live(page), 1)
  expect(mounted.listeners.length).toBeGreaterThan(0)
  expect(mounted.observers.length).toBeGreaterThan(0)
  // arm the shell's label timeout too, then unmount inside its 2.5s window
  await page.click('[data-sheet="settings"]')
  await page.click('#check-updates')
  await expect(page.locator('#check-updates')).toHaveText('✓ UP TO DATE')
  expect(ofGen(await live(page), 1).timers.some(t => t.kind === 'timeout' && t.ms === 2500)).toBe(true)

  // unmount 2: nothing generation 1 started may survive, and the floor is the floor
  await page.evaluate(() => window.__quarryLifecycle.unmount())
  await expect(page.locator('canvas')).toHaveCount(0)
  const after = await live(page)
  expect(ofGen(after, 1)).toEqual({ frames: 0, timers: [], listeners: [], observers: [] })
  expect(totals(after)).toEqual(totals(floor))
  expect(errors).toEqual([])
})

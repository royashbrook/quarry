import type { GameState, Point } from './engine'
import type { Viewport } from './viewport'

// the playwright suite drives the game through this hook (camera/offline/menu/audio/
// reset/smoke specs). it is installed only under DEV or MODE=test and must be ABSENT
// from a production bundle.
//
// kept NON-optional here on purpose. teardown must `delete window.__quarry`, which
// strict TS refuses on a required property, so the review asked for `__quarry?`. but
// optional here makes every existing `window.__quarry.foo()` in the 6 spec files
// possibly-undefined: 62 svelte-check errors, for a delete that happens at exactly ONE
// site. so the narrowing lives at that site (a local cast in Game.svelte's teardown)
// and the test call sites stay clean.
export interface QuarryHooks {
  snapshot: () => GameState
  movePlayer: (point: Point) => void
  advance: (seconds: number, input?: Point) => void
  viewport: () => Viewport
  cameraY: () => number
  joystickOrigin: () => Point | null
  pause: (on: boolean) => void
  setTime: (seconds: number) => void
  audioState: () => string
  /** the first-run coach beat, so a spec can prove a resize does not restart it */
  coachStep: () => 'move' | 'mine' | null
  /** css px reserved for the bottom nav, so a spec can prove resize remeasures it */
  bottomInset: () => number
  /** test-only: force audio idle-suspension, so the wake repair is provable */
  forceAudioIdle: () => void
}

declare global {
  interface Window {
    __quarry: QuarryHooks
  }
}

export {}

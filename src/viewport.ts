import type { Point } from './engine'

// the CAMERA sees one zone-sized window (960x640); the world is wider and the
// renderer pans by cameraX after this uniform fit. viewport math stays pure.
export const VIEW = { width: 960, height: 640 }

// One shared camera for rendering and input (#13). A single uniform scale fits
// the 960x640 world into whatever CSS viewport exists; the extra axis exposes
// MORE world (portrait above/below, wide screens left/right) instead of
// stretching sprites or letterboxing. Pure math, no DOM: main.ts owns the DOM.
export type Viewport = {
  cssWidth: number
  cssHeight: number
  scale: number // css px per world unit
  viewWidth: number // world units visible horizontally
  viewHeight: number // world units visible vertically
  originX: number // world x at the left CSS edge (negative when wider than world)
  originY: number // world y at the top CSS edge
  dpr: number // backing-store density, capped
}

export const DPR_CAP = 2

export function computeViewport(cssWidth: number, cssHeight: number, devicePixelRatio = 1): Viewport {
  const scale = Math.min(cssWidth / VIEW.width, cssHeight / VIEW.height)
  const viewWidth = cssWidth / scale
  const viewHeight = cssHeight / scale
  return {
    cssWidth,
    cssHeight,
    scale,
    viewWidth,
    viewHeight,
    originX: (VIEW.width - viewWidth) / 2,
    originY: (VIEW.height - viewHeight) / 2,
    dpr: Math.min(devicePixelRatio, DPR_CAP),
  }
}

/** Backing-store pixel dimensions for the canvas element. */
export function backingSize(view: Viewport): { width: number; height: number } {
  return { width: Math.round(view.cssWidth * view.dpr), height: Math.round(view.cssHeight * view.dpr) }
}

/** Client (CSS) coordinates relative to the canvas box, to world coordinates. */
export function clientToWorld(view: Viewport, clientX: number, clientY: number): Point {
  return { x: view.originX + clientX / view.scale, y: view.originY + clientY / view.scale }
}

/** World coordinates to client (CSS) coordinates relative to the canvas box. */
export function worldToClient(view: Viewport, world: Point): Point {
  return { x: (world.x - view.originX) * view.scale, y: (world.y - view.originY) * view.scale }
}

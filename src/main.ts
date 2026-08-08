import QRCode from 'qrcode'
import './style.css'
import { createGame, runFor, step, ZONE_W, type GameState, type Point } from './engine'
import { Controls } from './input'
import { Renderer } from './render'
import { loadSave, rescueUrl, storeSave } from './save'
import { backingSize, computeViewport, VIEW, type Viewport } from './viewport'

declare global {
  interface Window {
    __quarry: {
      snapshot: () => GameState
      movePlayer: (point: Point) => void
      advance: (seconds: number, input?: Point) => void
      viewport: () => Viewport
      cameraX: () => number
      joystickOrigin: () => Point | null
      pause: (on: boolean) => void
      setTime: (seconds: number) => void
    }
  }
}

const found = document.querySelector<HTMLCanvasElement>('#game')
if (!found) throw new Error('game canvas missing')
const canvas: HTMLCanvasElement = found

const state = createGame(loadSave())

let viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio)
function fitViewport(): void {
  viewport = computeViewport(innerWidth, innerHeight, devicePixelRatio)
  const backing = backingSize(viewport)
  if (canvas.width !== backing.width) canvas.width = backing.width
  if (canvas.height !== backing.height) canvas.height = backing.height
}
fitViewport()
addEventListener('resize', fitViewport)
new ResizeObserver(fitViewport).observe(document.body)

// the camera pans the wide world: keep the miner centered, clamped to the
// world's open span, eased so zone transitions glide instead of snapping
let cameraX = 0
function updateCamera(dt: number): void {
  const openWidth = ZONE_W * (state.save.gates + 1)
  const target = Math.max(0, Math.min(state.player.x - VIEW.width / 2, openWidth - viewport.viewWidth + (viewport.viewWidth - VIEW.width) / 2))
  cameraX += (target - cameraX) * Math.min(1, dt * 6)
}

const controls = new Controls(canvas, () => viewport, () => cameraX)
const renderer = new Renderer(canvas)
let previous = performance.now()
let saveClock = 0
let paused = false

function frame(now: number): void {
  const elapsed = Math.min(0.05, (now - previous) / 1000)
  previous = now
  if (!paused) {
    step(state, elapsed, controls.vector)
    updateCamera(elapsed)
  }
  renderer.draw(state, controls.joystick, viewport, cameraX)
  saveClock += elapsed
  if (saveClock >= 1) {
    saveClock = 0
    storeSave(state.save)
  }
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
addEventListener('pagehide', () => storeSave(state.save))

const dialog = document.querySelector<HTMLDialogElement>('#save-dialog')
const saveButton = document.querySelector<HTMLButtonElement>('#save-button')
const qr = document.querySelector<HTMLImageElement>('#save-qr')
const link = document.querySelector<HTMLAnchorElement>('#rescue-link')
if (dialog && saveButton && qr && link) {
  saveButton.addEventListener('click', async () => {
    storeSave(state.save)
    const url = await rescueUrl(state.save)
    qr.src = await QRCode.toDataURL(url, { width: 512, margin: 2, color: { dark: '#3D3230', light: '#F4EBDD' } })
    link.href = url
    dialog.showModal()
  })
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

// update toast: probe the served shell, compare to the booted shell, offer a
// one-tap reload. the probe bypasses the worker cache via ?update-probe.
const updateToast = document.querySelector<HTMLButtonElement>('#update-toast')
if (import.meta.env.PROD && updateToast) {
  let baseline: string | null = null
  const probe = async (): Promise<void> => {
    try {
      const response = await fetch('/?update-probe', { cache: 'no-store' })
      if (!response.ok) return
      const text = await response.text()
      if (baseline === null) baseline = text
      else if (text !== baseline) updateToast.hidden = false
    } catch { /* offline: nothing to say */ }
  }
  updateToast.addEventListener('click', () => location.reload())
  probe()
  setInterval(probe, 5 * 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void probe() })
}

window.__quarry = {
  snapshot: () => structuredClone(state),
  movePlayer: point => { state.player.x = point.x; state.player.y = point.y },
  advance: (seconds, input) => runFor(state, seconds, input),
  viewport: () => ({ ...viewport }),
  cameraX: () => cameraX,
  joystickOrigin: () => (controls.joystick.active ? { ...controls.joystick.origin } : null),
  pause: on => { paused = on },
  setTime: seconds => { state.time = seconds },
}

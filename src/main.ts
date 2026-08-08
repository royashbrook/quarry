import QRCode from 'qrcode'
import './style.css'
import { createGame, runFor, step, WORLD, type GameState, type Point } from './engine'
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
      cameraY: () => number
      joystickOrigin: () => Point | null
      pause: (on: boolean) => void
      setTime: (seconds: number) => void
      audioState: () => string
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

// the camera follows the miner DOWN the dig, eased, clamped to the world
let cameraY = 0
function updateCamera(dt: number): void {
  const target = Math.max(0, Math.min(state.player.y - VIEW.height * 0.45, WORLD.height - viewport.viewHeight + (viewport.viewHeight - VIEW.height) / 2))
  cameraY += (target - cameraY) * Math.min(1, dt * 6)
}

const controls = new Controls(canvas, () => viewport, () => cameraY)
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
  state.pings.splice(0).forEach(bleep) // drain feel events even while paused
  renderer.draw(state, controls.joystick, viewport, cameraY)
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

// tiny synth: the engine queues pings, we bleep them. no assets, one oscillator
// per sound, context created on first gesture (autoplay policy), mute persists.
const MUTE_KEY = 'quarry_mute'
const muteButton = document.querySelector<HTMLButtonElement>('#mute-button')
let muted = localStorage.getItem(MUTE_KEY) === '1'
let audio: AudioContext | null = null
const syncMute = () => { if (muteButton) muteButton.textContent = muted ? '🔇' : '🔊' }
syncMute()
muteButton?.addEventListener('click', () => {
  muted = !muted
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  syncMute()
})
function wakeAudio(): void {
  if (!audio) {
    audio = new AudioContext()
    // ios mutes webaudio under the ringer switch unless the page declares
    // itself playback audio (ios 17+); harmless everywhere else
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) session.type = 'playback'
  }
  if (audio.state === 'suspended') void audio.resume()
}
addEventListener('pointerdown', wakeAudio)
addEventListener('keydown', wakeAudio)
document.addEventListener('visibilitychange', () => { if (!document.hidden && audio?.state === 'suspended') void audio.resume() })

const TONES: Record<string, [number, number, OscillatorType]> = {
  swing: [180, 0.05, 'square'],
  break: [90, 0.16, 'sawtooth'],
  coin: [880, 0.07, 'sine'],
  buy: [520, 0.12, 'triangle'],
  gate: [130, 0.4, 'sawtooth'],
  contract: [660, 0.3, 'triangle'],
}
function bleep(kind: string): void {
  if (muted || !audio || audio.state !== 'running') return
  const [freq, seconds, shape] = TONES[kind] ?? TONES.coin
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = shape
  osc.frequency.value = freq
  if (kind === 'gate' || kind === 'contract') osc.frequency.exponentialRampToValueAtTime(freq * 2, audio.currentTime + seconds)
  gain.gain.setValueAtTime(0.08, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + seconds)
  osc.connect(gain).connect(audio.destination)
  osc.start()
  osc.stop(audio.currentTime + seconds)
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
  cameraY: () => cameraY,
  joystickOrigin: () => (controls.joystick.active ? { ...controls.joystick.origin } : null),
  pause: on => { paused = on },
  setTime: seconds => { state.time = seconds },
  audioState: () => (muted ? 'muted' : audio?.state ?? 'none'),
}

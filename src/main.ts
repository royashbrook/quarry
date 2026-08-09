import QRCode from 'qrcode'
import './style.css'
import { buyUpgrade, capacity, createGame, currentMine, HELPER_PRICES, hireHelperNow, mineMultiplier, mineReach, MONUMENT_STAGES, pickDamage, prestigeMultiplier, prestigeNow, runFor, step, upgradeMax, upgradePrice, UPGRADES, walkSpeed, WORLD, type GameState, type Point, type UpgradeId } from './engine'
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
renderer.audioState = () => (muted ? 'muted' : idleSuspended ? 'running' : audio?.state ?? 'none')
let previous = performance.now()
let saveClock = 0
let paused = true // the start card owns boot; PLAY unpauses
let resetting = false // once armed-and-fired, nothing may write the save again

function frame(now: number): void {
  const elapsed = Math.min(0.05, (now - previous) / 1000)
  previous = now
  if (!paused) {
    step(state, elapsed, controls.vector)
    updateCamera(elapsed)
  }
  if (renderer.coachStep === 'move' && coachOrigin
    && Math.hypot(state.player.x - coachOrigin.x, state.player.y - coachOrigin.y) > 60) renderer.coachStep = 'mine'
  if (renderer.coachStep === 'mine' && state.stack.length > 0) renderer.coachStep = null
  state.pings.splice(0).forEach(bleep) // drain feel events even while paused
  if (audio && audio.state === 'running' && performance.now() - lastBleepAt > 15000) {
    idleSuspended = true
    void audio.suspend() // drops the system "playing" indicator between sounds
  }
  renderer.draw(state, controls.joystick, viewport, cameraY)
  saveClock += elapsed
  if (saveClock >= 1 && !resetting) {
    saveClock = 0
    storeSave(state.save)
  }
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
addEventListener('pagehide', () => { if (!resetting) storeSave(state.save) })

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

// ===== start card, bottom nav, sheets (#17) =====
const startCard = document.querySelector<HTMLElement>('#start-card')
const startStats = document.querySelector<HTMLElement>('#start-stats')
const playButton = document.querySelector<HTMLButtonElement>('#play-button')
const bottomNav = document.querySelector<HTMLElement>('#bottom-nav')
const backdrop = document.querySelector<HTMLElement>('#sheet-backdrop')
const sheets: Record<string, HTMLElement | null> = {
  shop: document.querySelector('#sheet-shop'),
  stats: document.querySelector('#sheet-stats'),
  settings: document.querySelector('#sheet-settings'),
}

if (startStats) {
  const save = state.save
  startStats.textContent = save.lifetime === 0
    ? 'a tiny mining game'
    : `mine ${save.mine + 1} · ${save.coins} · ${save.lifetime} lifetime`
}
// a fresh save gets two coached beats: move, then mine. each advances on the
// real action and the whole thing never appears again once lifetime coins exist.
let coachOrigin: Point | null = null
playButton?.addEventListener('click', () => {
  startCard?.setAttribute('hidden', '')
  bottomNav?.removeAttribute('hidden')
  paused = false
  if (state.save.lifetime === 0) {
    renderer.coachStep = 'move'
    coachOrigin = { x: state.player.x, y: state.player.y }
  }
})

function closeSheets(): void {
  for (const sheet of Object.values(sheets)) sheet?.setAttribute('hidden', '')
  backdrop?.setAttribute('hidden', '')
  bottomNav?.querySelectorAll('button').forEach(button => button.removeAttribute('data-active'))
}
backdrop?.addEventListener('click', closeSheets)
bottomNav?.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button')
  const name = button?.dataset.sheet
  if (!name) return
  const sheet = sheets[name]
  const isOpen = sheet && !sheet.hasAttribute('hidden')
  closeSheets()
  if (isOpen || !sheet) return
  sheet.removeAttribute('hidden')
  backdrop?.removeAttribute('hidden')
  button?.setAttribute('data-active', '')
  if (name === 'shop') renderShop()
  if (name === 'stats') renderStats()
})

// the menu shop: same engine purchase path as the world pads, from anywhere
const SHOP_META: Record<UpgradeId, { name: string; desc: string; icon: string }> = {
  pick: { name: 'PICKAXE', desc: 'more damage per swing', icon: '⛏' },
  pack: { name: 'PACK', desc: 'carry more chunks', icon: '🎒' },
  boots: { name: 'BOOTS', desc: 'walk faster', icon: '👢' },
  swing: { name: 'SWING', desc: 'swing more often', icon: '💪' },
  reach: { name: 'REACH', desc: 'mine from farther away', icon: '🧲' },
  cart: { name: 'CART', desc: 'chute pays more, travels faster', icon: '🛒' },
}
function renderShop(): void {
  const list = document.querySelector('#shop-list')
  if (!list) return
  const rows: string[] = []
  for (const id of Object.keys(SHOP_META) as UpgradeId[]) {
    const meta = SHOP_META[id]
    const level = state.save.upgrades[id]
    const max = upgradeMax(id, state.save.mines.length)
    const maxed = level >= max
    const price = maxed ? 0 : upgradePrice(id, level)
    rows.push(`<div class="shop-row"><span>${meta.icon}</span>
      <span class="grow"><span class="name">${meta.name} LV${level}/${max}</span><br><span class="desc">${meta.desc}</span></span>
      <button data-buy="${id}" ${maxed || state.save.coins < price ? 'disabled' : ''}>${maxed ? 'MAX' : `${price}`}</button></div>`)
  }
  const mine = currentMine(state.save)
  const helperMaxed = mine.helpers >= HELPER_PRICES.length
  const helperPrice = helperMaxed ? 0 : HELPER_PRICES[mine.helpers] * mineMultiplier(state.save.mine)
  rows.push(`<div class="shop-row"><span>👷</span>
    <span class="grow"><span class="name">HELPER ×${mine.helpers}/${HELPER_PRICES.length}</span><br><span class="desc">mines and sells on their own, stays in this mine</span></span>
    <button data-hire="1" ${helperMaxed || state.save.coins < helperPrice ? 'disabled' : ''}>${helperMaxed ? 'MAX' : `${helperPrice}`}</button></div>`)
  list.innerHTML = rows.join('')
}
document.querySelector('#stats-list')?.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('#prestige-button')
  if (!button) return
  if (!button.dataset.armed) {
    button.dataset.armed = '1'
    button.textContent = '!? EVERYTHING RESETS, TAP AGAIN'
    return
  }
  if (prestigeNow(state)) {
    storeSave(state.save)
    closeSheets()
  }
})

document.querySelector('#shop-list')?.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest('button')
  if (!button || button.disabled) return
  if (button.dataset.buy) buyUpgrade(state, button.dataset.buy as UpgradeId)
  if (button.dataset.hire) hireHelperNow(state)
  storeSave(state.save)
  renderShop()
})

function renderStats(): void {
  const list = document.querySelector('#stats-list')
  if (!list) return
  const save = state.save
  const staffed = save.mines.reduce((total, mine) => total + mine.helpers, 0)
  // the monument's reward: start over richer. two taps, like every teardown.
  const prestigeRow = save.monument >= MONUMENT_STAGES.length
    ? `<button id="prestige-button" class="big-button prestige">⭐ NEW QUARRY ×${prestigeMultiplier(save) + 0.5}</button>`
    : ''
  list.innerHTML = prestigeRow + `<dl class="stats-row">
    <dt>coins</dt><dd>${save.coins}</dd>
    <dt>lifetime earned</dt><dd>${save.lifetime}</dd>
    <dt>mine</dt><dd>${save.mine + 1}</dd>
    <dt>contracts done</dt><dd>${save.contractsDone}</dd>
    <dt>monument</dt><dd>${save.monument}/5</dd>
    <dt>crew across mines</dt><dd>${staffed}</dd>
    <dt>pick damage</dt><dd>${pickDamage(state)}</dd>
    <dt>pack size</dt><dd>${capacity(state)}</dd>
    <dt>walk speed</dt><dd>${walkSpeed(state)}</dd>
    <dt>mining reach</dt><dd>${mineReach(state)}</dd>
  </dl>`
}

// second reset entry point in the settings sheet, same two-tap contract
if (!import.meta.env.PROD) {
  const checkButton = document.querySelector<HTMLButtonElement>('#check-updates')
  checkButton?.addEventListener('click', () => { checkButton.textContent = '↻ DEV BUILD' })
}

const resetButton2 = document.querySelector<HTMLButtonElement>('#reset-save2')
resetButton2?.addEventListener('click', () => {
  if (!resetButton2.dataset.armed) {
    resetButton2.dataset.armed = '1'
    resetButton2.textContent = '!? SURE? TAP AGAIN'
    return
  }
  resetting = true
  localStorage.removeItem('quarry_save_v1')
  location.reload()
})

// total reset, two taps: the first arms the button (it turns solid), the
// second wipes the save and reloads. closing the dialog disarms it.
const resetButton = document.querySelector<HTMLButtonElement>('#reset-save')
if (resetButton && dialog) {
  resetButton.addEventListener('click', () => {
    if (!resetButton.dataset.armed) {
      resetButton.dataset.armed = '1'
      resetButton.textContent = '!?'
      return
    }
    resetting = true
    localStorage.removeItem('quarry_save_v1')
    location.reload()
  })
  dialog.addEventListener('close', () => {
    delete resetButton.dataset.armed
    resetButton.textContent = '🗑'
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
// a game, not a music app (roy: the playing indicator never went away). the
// ambient category mixes with the player's own audio and respects the ringer
// switch, which is how well-behaved ios games sound. the engine also suspends
// itself after idle so the system audio indicator drops when nothing bleeps.
let lastBleepAt = 0
let idleSuspended = false
function wakeAudio(): void {
  if (!audio) {
    audio = new AudioContext()
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) session.type = 'ambient'
  }
  if (audio.state === 'suspended') {
    idleSuspended = false
    void audio.resume()
  }
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
  lastBleepAt = performance.now()
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
  const checkButton = document.querySelector<HTMLButtonElement>('#check-updates')
  checkButton?.addEventListener('click', async () => {
    checkButton.textContent = '↻ CHECKING…'
    await probe()
    if (!updateToast.hidden) {
      checkButton.textContent = '↻ UPDATE READY, TAP TO RELOAD'
      checkButton.onclick = () => location.reload()
    } else {
      checkButton.textContent = '✓ UP TO DATE'
      setTimeout(() => { checkButton.textContent = '↻ CHECK FOR UPDATES' }, 2500)
    }
  })
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
  audioState: () => (muted ? 'muted' : idleSuspended ? 'idle' : audio?.state ?? 'none'),
}

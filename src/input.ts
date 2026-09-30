import type { Input, Point } from './engine'
import { clientToWorld, type Viewport } from './viewport'

export class Controls {
  readonly vector: Input = { x: 0, y: 0 }
  readonly joystick = { active: false, origin: { x: 0, y: 0 }, current: { x: 0, y: 0 } }
  private keys = new Set<string>()
  private pointer: number | null = null
  // every listener attaches under this signal so destroy() detaches all eight at
  // once. the svelte wrap mounts and unmounts the game; a remount that left the
  // old window/canvas listeners live would double-drive input and leak (a leaked
  // handler is invisible until it isn't). one abort, no orphans.
  private ac = new AbortController()

  constructor(private canvas: HTMLCanvasElement, private view: () => Viewport, private cameraY: () => number) {
    const signal = this.ac.signal
    addEventListener('keydown', event => {
      const game = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
      if (event.metaKey || event.ctrlKey || event.altKey) return // shortcuts stay native
      if (!game.includes(event.key.toLowerCase())) return // only consume our keys
      this.keys.add(event.key.toLowerCase())
      this.readKeys()
      event.preventDefault()
    }, { signal })
    addEventListener('keyup', event => { this.keys.delete(event.key.toLowerCase()); this.readKeys() }, { signal })
    // a blurred window must never keep walking on a held key
    addEventListener('blur', () => { this.keys.clear(); this.readKeys() }, { signal })
    addEventListener('pagehide', () => { this.keys.clear(); this.readKeys() }, { signal })
    canvas.addEventListener('pointerdown', event => this.down(event), { signal })
    canvas.addEventListener('pointermove', event => this.move(event), { signal })
    canvas.addEventListener('pointerup', event => this.up(event), { signal })
    canvas.addEventListener('pointercancel', event => this.up(event), { signal })
  }

  // detach all listeners and release any held pointer capture. idempotent: a second
  // call is a no-op (the signal is already aborted).
  destroy(): void {
    if (this.pointer !== null) {
      try { this.canvas.releasePointerCapture(this.pointer) } catch { /* already gone */ }
      this.pointer = null
    }
    this.ac.abort()
  }

  private down(event: PointerEvent): void {
    if (this.pointer !== null) return
    this.pointer = event.pointerId
    this.canvas.setPointerCapture(event.pointerId)
    const point = this.toWorld(event)
    this.joystick.active = true
    this.joystick.origin = point
    this.joystick.current = point
  }

  private move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    this.joystick.current = this.toWorld(event)
    const dx = this.joystick.current.x - this.joystick.origin.x
    const dy = this.joystick.current.y - this.joystick.origin.y
    const length = Math.max(55, Math.hypot(dx, dy))
    this.vector.x = dx / length
    this.vector.y = dy / length
  }

  private up(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return
    this.pointer = null
    this.joystick.active = false
    this.vector.x = 0
    this.vector.y = 0
    this.readKeys()
  }

  private readKeys(): void {
    if (this.pointer !== null) return
    const pressed = (...names: string[]) => names.some(name => this.keys.has(name))
    this.vector.x = Number(pressed('d', 'arrowright')) - Number(pressed('a', 'arrowleft'))
    this.vector.y = Number(pressed('s', 'arrowdown')) - Number(pressed('w', 'arrowup'))
  }

  private toWorld(event: PointerEvent): Point {
    // same live viewport the renderer draws through, plus the camera pan
    const rect = this.canvas.getBoundingClientRect()
    const world = clientToWorld(this.view(), event.clientX - rect.left, event.clientY - rect.top)
    return { x: world.x, y: world.y + this.cameraY() }
  }
}

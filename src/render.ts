// quarry's renderer, portrait-first: the world is a vertical dig, the camera
// pans down through strata, and EVERY piece of text draws in SCREEN space with
// a 13 css px floor so a phone can actually read it. all art is canvas vectors.
import type { Chip, GameState, Ore, Point, Rock, Spark, UpgradeId } from './engine'
import { BUY_CHARGE_SECONDS, capacity, CHUTES, currentMine, DEPOT, GATES, HELPER_PAD, HELPER_PRICES, mineMultiplier, MONUMENT, MONUMENT_STAGES, ORES, pickDamage, RAIL_X, SHOP, SURFACE, TRAVEL, travelPickNeeded, travelPrice, upgradeMax, upgradePrice, UPGRADES, WORLD, ZONE_H } from './engine'
import { worldToClient, type Viewport } from './viewport'

type Joystick = { active: boolean; origin: Point; current: Point }

export const PALETTE = {
  sky: '#BDE3F0',
  grass: '#8FCB6B',
  topsoil: '#C9A176',
  stoneStrata: '#8E8A82',
  deepStrata: '#5F5A6E',
  strataLine: 'rgba(61,50,48,.18)',
  ink: '#3D3230',
  paper: '#F4EBDD',
  coin: '#FFD45E',
  coinDeep: '#E2A93B',
  wood: '#9C6B44',
  stoneLight: '#C7C3BD',
  ore: {
    stone: '#A9A49C',
    coal: '#3E3A42',
    copper: '#D98E4A',
    gold: '#F2C84B',
    crystal: '#7BD8D0',
  } as Record<Ore, string>,
}

const ORE_LABEL: Record<Ore, string> = { stone: 'STONE', coal: 'COAL', copper: 'COPPER', gold: 'GOLD', crystal: 'CRYSTAL' }
const FONT = 'ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif'

export class Renderer {
  readonly context: CanvasRenderingContext2D
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  /** set by the shell; lets the hud show the truth about sound on screen */
  audioState: () => string = () => 'none'
  /** set by the shell; 'move' | 'mine' | null drives the first-minute coach */
  coachStep: 'move' | 'mine' | null = null
  /** css px of ui docked at the screen bottom (the nav); hud stays above it */
  bottomInset = 0

  /** the HUD is shell CHROME, not world art, so it paints from the shell's theme
   *  tokens like the rest of the chrome. resolved from the document (cached, and
   *  refreshed by refreshTokens() when the theme changes) so a canvas-drawn HUD still
   *  reskins with a theme swap instead of staying literal. */
  private tokens = Renderer.readTokens()

  static readTokens(): { raised: string; ink: string; inkDim: string; accent: string; onAccent: string; warn: string; font: string; radius: number } {
    const fallback = { raised: '#f4ebdd', ink: '#3d3230', inkDim: '#6d5f58', accent: '#ffc94d', onAccent: '#3d3230', warn: '#a04848', font: FONT, radius: 16 }
    if (typeof document === 'undefined') return fallback
    const cs = getComputedStyle(document.documentElement)
    const read = (name: string, or: string): string => cs.getPropertyValue(name).trim() || or
    return {
      raised: read('--surface-raised', fallback.raised),
      ink: read('--ink', fallback.ink),
      inkDim: read('--ink-dim', fallback.inkDim),
      accent: read('--accent', fallback.accent),
      onAccent: read('--ink-on-accent', fallback.onAccent),
      warn: read('--warn', fallback.warn),
      font: read('--font-ui', fallback.font),
      radius: Renderer.toPx(read('--radius', '1rem')),
    }
  }

  /** resolve a css length token to px. the first version assumed every value was
   *  rem-like and multiplied by 16, so a px or calc() token would misresolve. this
   *  asks the document what the value actually computes to. */
  static toPx(value: string): number {
    if (typeof document === 'undefined') return 16
    const px = Number.parseFloat(value)
    if (value.endsWith('px')) return Number.isFinite(px) ? px : 16
    if (value.endsWith('rem')) {
      const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      return (Number.isFinite(px) ? px : 1) * rootPx
    }
    // anything else (calc, em, unitless): measure it for real
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;visibility:hidden;width:${value}`
    document.body.appendChild(probe)
    const measured = probe.getBoundingClientRect().width
    probe.remove()
    return Number.isFinite(measured) ? measured : 16
  }

  /** call after a theme swap so the canvas HUD repaints in the new palette.
   *  Game.svelte watches data-theme on the root and calls this. */
  refreshTokens(): void {
    this.tokens = Renderer.readTokens()
  }

  /** a token colour at an alpha. the HUD's cards are the ink token at 75-86%, which
   *  a hard-coded rgba() could not follow when the theme changed. */
  private alpha(color: string, a: number): string {
    const hex = color.trim()
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)
    if (!m) return hex
    const full = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
    const n = Number.parseInt(full, 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
  }

  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    this.context = context
  }

  draw(state: GameState, joystick: Joystick, view: Viewport, cameraY: number): void {
    const ctx = this.context
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const k = view.dpr * view.scale
    const amp = this.reducedMotion ? 0.3 : 1
    const shakeX = state.shake > 0 ? Math.sin(state.time * 71) * state.shake * 20 * amp : 0
    const shakeY = state.shake > 0 ? Math.cos(state.time * 83) * state.shake * 14 * amp : 0
    ctx.setTransform(k, 0, 0, k, (-view.originX + shakeX) * k, (-view.originY - cameraY + shakeY) * k)

    this.drawGround(state, view, cameraY)
    this.drawRail(state, view, cameraY)

    const things: { anchor: Point; draw: () => void }[] = [
      { anchor: MONUMENT, draw: () => this.drawMonument(state) },
      { anchor: DEPOT, draw: () => this.drawDepot(state) },
      { anchor: HELPER_PAD, draw: () => this.drawHelperPad(state) },
      ...state.helpers.map(helper => ({ anchor: helper, draw: () => this.drawHelper(state, helper) })),
      ...(Object.keys(SHOP) as UpgradeId[]).map(id => ({ anchor: SHOP[id], draw: () => this.drawShopPad(state, id) })),
      ...state.rocks.filter(rock => rock.respawn === 0).map(rock => ({ anchor: rock, draw: () => this.drawRock(rock) })),
      { anchor: state.player, draw: () => this.drawMiner(state) },
    ]
    things.sort((a, b) => a.anchor.y - b.anchor.y).forEach(item => item.draw())
    GATES.forEach((gatePos, index) => this.drawGate(state, index)) // walls draw over everything at their line
    this.drawShaft(state)
    state.chips.forEach(chip => this.drawChip(chip.x, chip.y, chip.ore))
    this.drawSparks(state.sparks)

    // === screen space from here: constant css sizes, readable on any phone ===
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    state.floats.forEach(item => {
      const client = worldToClient(view, { x: item.x, y: item.y - cameraY })
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - item.age)
      this.text(item.text, client.x, client.y, item.kind === 'coin' ? 18 : 15, item.kind === 'coin' ? '#8A6408' : '#FFF', true)
      ctx.restore()
    })
    this.worldLabels(state, view, cameraY)
    this.drawHud(state, view)
    if (joystick.active) this.drawJoystick(joystick, view, cameraY)
  }

  private drawGround(state: GameState, view: Viewport, cameraY: number): void {
    const ctx = this.context
    const left = view.originX
    const top = view.originY + cameraY
    const right = left + view.viewWidth
    const bottom = top + view.viewHeight
    // strata bands: sky, grass lip, topsoil, stone, deep
    const bands: [number, number, string][] = [
      [-2000, 150, PALETTE.sky],
      [150, 190, PALETTE.grass],
      [190, SURFACE + ZONE_H, PALETTE.topsoil],
      [SURFACE + ZONE_H, SURFACE + ZONE_H * 2, PALETTE.stoneStrata],
      [SURFACE + ZONE_H * 2, WORLD.height + 2000, PALETTE.deepStrata],
    ]
    for (const [from, to, color] of bands) {
      const y0 = Math.max(top, from)
      const y1 = Math.min(bottom, to)
      if (y1 <= y0) continue
      ctx.fillStyle = color
      ctx.fillRect(left, y0, view.viewWidth, y1 - y0)
    }
    // strata lips: each boundary gets a shadowed edge and a catch-light rim,
    // which is most of what makes the bands read as depth instead of stripes
    for (const edge of [190, SURFACE + ZONE_H, SURFACE + ZONE_H * 2]) {
      if (edge < top - 20 || edge > bottom + 20) continue
      ctx.fillStyle = 'rgba(30,24,28,.22)'
      ctx.fillRect(left, edge - 7, view.viewWidth, 7)
      ctx.fillStyle = 'rgba(255,255,255,.12)'
      ctx.fillRect(left, edge, view.viewWidth, 3)
    }
    // sediment lines, fixed pattern, and buried speckles for texture
    ctx.strokeStyle = PALETTE.strataLine
    ctx.lineWidth = 2
    for (let y = Math.max(230, Math.floor(top / 90) * 90); y < bottom; y += 90) {
      ctx.beginPath()
      ctx.moveTo(left, y + Math.sin(y) * 6)
      ctx.quadraticCurveTo((left + right) / 2, y + 10 + Math.sin(y * 3) * 6, right, y + Math.sin(y * 1.7) * 6)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,255,255,.08)'
    for (let y = Math.floor(top / 130) * 130; y < bottom; y += 130) {
      const x = 60 + ((y * 7919) % 420)
      if (y > 230) { ctx.beginPath(); ctx.arc(x, y + 40, 7, 0, Math.PI * 2); ctx.fill() }
    }
    // dust motes drift in the deeper strata: cheap ambience, deterministic
    if (!this.reducedMotion && bottom > SURFACE + ZONE_H) {
      ctx.fillStyle = 'rgba(255,255,255,.12)'
      for (let i = 0; i < 14; i++) {
        const y = SURFACE + ZONE_H + ((i * 173 + state.time * 9) % (ZONE_H * 2))
        if (y < top || y > bottom) continue
        const x = 40 + ((i * 97) % 460) + Math.sin(state.time * 0.7 + i) * 18
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill()
      }
    }
    // deep zone gets faint crystal glints
    if (bottom > SURFACE + ZONE_H * 2) {
      ctx.fillStyle = 'rgba(123,216,208,.25)'
      for (let y = Math.max(top, SURFACE + ZONE_H * 2); y < bottom; y += 170) {
        const x = 90 + ((y * 104729) % 380)
        ctx.beginPath(); ctx.arc(x, y + 60, 4, 0, Math.PI * 2); ctx.fill()
      }
    }
  }

  // the rail runs the full dig on the right edge; chutes feed it, and the cart
  // rides the OLDEST transit chunk's progress so dumps visibly travel home.
  private drawRail(state: GameState, view: Viewport, cameraY: number): void {
    const ctx = this.context
    const top = view.originY + cameraY
    const bottom = top + view.viewHeight
    ctx.strokeStyle = 'rgba(61,50,48,.35)'
    ctx.lineWidth = 5
    ctx.beginPath(); ctx.moveTo(RAIL_X, Math.max(top, DEPOT.y)); ctx.lineTo(RAIL_X, Math.min(bottom, WORLD.height - 60)); ctx.stroke()
    ctx.lineWidth = 3
    for (let y = Math.max(Math.floor(top / 44) * 44, 264); y < bottom; y += 44) {
      ctx.beginPath(); ctx.moveTo(RAIL_X - 10, y); ctx.lineTo(RAIL_X + 10, y); ctx.stroke()
    }
    for (const spot of CHUTES) {
      this.shadow(spot.x, spot.y + 12, 52, 12)
      ctx.fillStyle = PALETTE.wood
      roundRect(ctx, spot.x - 44, spot.y - 20, 88, 34, 8)
      ctx.fillStyle = '#7A5232'
      roundRect(ctx, spot.x - 36, spot.y - 14, 72, 20, 6)
      this.ring(spot.x, spot.y + 10, 56, 20, state.stack.length > 0)
    }
    const oldest = state.transit[0]
    if (oldest) {
      const progress = 1 - oldest.remaining / oldest.total
      const cartY = oldest.fromY + (DEPOT.y - oldest.fromY) * progress
      ctx.fillStyle = '#6B4A2F'
      roundRect(ctx, RAIL_X - 16, cartY - 12, 32, 20, 6)
      ctx.fillStyle = PALETTE.ore[oldest.ore]
      roundRect(ctx, RAIL_X - 10, cartY - 18, 20, 10, 4)
      ctx.fillStyle = PALETTE.ink
      lump(ctx, RAIL_X - 8, cartY + 10, 5)
      lump(ctx, RAIL_X + 8, cartY + 10, 5)
    }
  }

  private drawRock(rock: Rock): void {
    const ctx = this.context
    const wobble = this.reducedMotion ? 0 : Math.sin(rock.wobble * 14) * rock.wobble * 0.06
    const healthy = rock.hp / ORES[rock.ore].hp
    const size = 40 + 18 * healthy
    this.shadow(rock.x, rock.y + 8, size + 10, 13)
    ctx.save()
    ctx.translate(rock.x, rock.y)
    ctx.rotate(wobble)
    // deeper strata read darker: the same rock sits moodier the farther down
    const depthDim = rock.y > SURFACE + ZONE_H * 2 ? 0.82 : rock.y > SURFACE + ZONE_H ? 0.9 : 1
    if (depthDim < 1) ctx.filter = `brightness(${depthDim})`
    
    ctx.fillStyle = PALETTE.ore[rock.ore]
    lump(ctx, -size * 0.4, -size * 0.35, size * 0.62)
    lump(ctx, size * 0.34, -size * 0.3, size * 0.55)
    lump(ctx, 0, -size * 0.62, size * 0.6)
    ctx.fillStyle = 'rgba(255,255,255,.28)'
    lump(ctx, -size * 0.16, -size * 0.72, size * 0.22)
    if (rock.ore !== 'stone') {
      ctx.fillStyle = PALETTE.stoneLight
      lump(ctx, size * 0.3, -size * 0.62, size * 0.16)
      lump(ctx, -size * 0.42, -size * 0.18, size * 0.14)
    }
    // damage reads as cracks: one line per lost third of hp
    const lost = 1 - healthy
    if (lost > 0.15) {
      ctx.strokeStyle = 'rgba(30,24,28,.5)'
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(-size * .3, -size * .8); ctx.lineTo(-size * .1, -size * .4); ctx.lineTo(-size * .25, -size * .1); ctx.stroke()
    }
    if (lost > 0.55) {
      ctx.strokeStyle = 'rgba(30,24,28,.5)'
      ctx.beginPath(); ctx.moveTo(size * .35, -size * .7); ctx.lineTo(size * .15, -size * .35); ctx.lineTo(size * .38, -size * .05); ctx.stroke()
    }
    ctx.restore()
  }

  private drawMiner(state: GameState): void {
    const ctx = this.context
    const player = state.player
    const stride = player.moving && !this.reducedMotion ? Math.sin(state.time * 12) : 0
    const bob = Math.abs(stride) * -5
    this.shadow(player.x, player.y + 4, 42, 11)
    ctx.save()
    ctx.translate(player.x, player.y + bob)
    ctx.scale(player.facing, 1)
    if (player.moving && !this.reducedMotion) ctx.rotate(0.05) // lean into the walk
    ctx.fillStyle = '#4A5A78'
    roundRect(ctx, -20, -34, 17, 36, 8, stride * 6)
    roundRect(ctx, 3, -34, 17, 36, 8, -stride * 6)
    // off-arm swings opposite the stride
    ctx.save()
    ctx.translate(-20, -70)
    ctx.rotate(stride * 0.5)
    ctx.fillStyle = '#E4863B'
    roundRect(ctx, -6, 0, 12, 34, 6)
    ctx.fillStyle = '#F2C9A2'
    ctx.beginPath(); ctx.arc(0, 36, 7, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    ctx.fillStyle = '#E4863B'
    roundRect(ctx, -25, -78, 50, 52, 16)
    ctx.fillStyle = '#F2B04A'
    roundRect(ctx, -25, -78, 50, 18, 9)
    ctx.fillStyle = '#F2C9A2'
    ctx.beginPath(); ctx.arc(0, -102, 26, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#F7D14A'
    ctx.beginPath(); ctx.arc(0, -112, 24, Math.PI, 0); ctx.fill()
    roundRect(ctx, -28, -114, 56, 8, 4)
    ctx.fillStyle = PALETTE.ink
    ctx.beginPath(); ctx.arc(8, -100, 3.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(20, -100, 3.4, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(14, -92, 6, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
    const swingPhase = player.swinging ? Math.sin((player.swing / 0.55) * Math.PI) : 0
    // pick material follows its level band: wood, iron, gold, diamond
    const pickLevel = state.save.upgrades.pick
    const pickHead = pickLevel >= 12 ? '#7BD8D0' : pickLevel >= 8 ? '#F2C84B' : pickLevel >= 4 ? '#B9C0C9' : '#8D9096'
    ctx.save()
    ctx.translate(18, -70)
    ctx.rotate(-0.8 + swingPhase * 1.5)
    ctx.fillStyle = PALETTE.wood
    roundRect(ctx, -4, -46, 8, 50, 4)
    ctx.fillStyle = pickHead
    ctx.beginPath()
    ctx.moveTo(-20, -46); ctx.quadraticCurveTo(0, -60, 20, -46)
    ctx.quadraticCurveTo(0, -50, -20, -46)
    ctx.fill()
    ctx.restore()
    // the pack grows with capacity so the upgrade shows on your back
    const packSize = 10 + Math.min(18, state.save.upgrades.pack * 2)
    ctx.fillStyle = '#6B4A2F'
    roundRect(ctx, -25 - packSize * 0.5, -70, packSize, 26 + packSize * 0.6, 8)
    ctx.fillStyle = 'rgba(255,255,255,.18)'
    roundRect(ctx, -25 - packSize * 0.5, -70, packSize, 8, 4)
    ctx.restore()
    // carried stack rides behind the miner
    const baseX = player.x - player.facing * 30
    for (let i = 0; i < state.stack.length; i++) {
      const sway = this.reducedMotion ? 0 : Math.sin(state.time * 8 + i * 0.6) * Math.min(6, i)
      this.drawChip(baseX + sway * 0.4, player.y - 44 - i * 11, state.stack[i])
    }
  }

  private drawChip(x: number, y: number, ore: Ore): void {
    const ctx = this.context
    ctx.fillStyle = PALETTE.ore[ore]
    roundRect(ctx, x - 10, y - 8, 20, 16, 5)
    ctx.fillStyle = 'rgba(255,255,255,.3)'
    roundRect(ctx, x - 6, y - 6, 8, 5, 2.5)
  }

  private drawSparks(sparks: Spark[]): void {
    const ctx = this.context
    for (const spark of sparks) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, 1 - spark.age * 2)
      ctx.fillStyle = '#FFF3C4'
      ctx.beginPath(); ctx.arc(spark.x, spark.y, 3.5, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
  }

  private drawDepot(state: GameState): void {
    const ctx = this.context
    this.shadow(DEPOT.x, DEPOT.y + 18, 90, 18)
    ctx.fillStyle = PALETTE.wood
    roundRect(ctx, DEPOT.x - 80, DEPOT.y - 24, 160, 46, 12)
    ctx.fillStyle = '#B5804F'
    roundRect(ctx, DEPOT.x - 80, DEPOT.y - 24, 160, 15, 7)
    coin(ctx, DEPOT.x - 44, DEPOT.y - 42, 15)
    coin(ctx, DEPOT.x + 44, DEPOT.y - 42, 15)
    this.ring(DEPOT.x, DEPOT.y + 14, 88, 30, state.stack.length > 0)
  }

  private drawShopPad(state: GameState, id: UpgradeId): void {
    const ctx = this.context
    const spot = SHOP[id]
    const level = state.save.upgrades[id]
    const maxed = level >= upgradeMax(id, state.save.mines.length)
    const price = upgradePrice(id, level)
    const affordable = !maxed && state.save.coins >= price
    this.shadow(spot.x, spot.y + 14, 56, 13)
    ctx.fillStyle = PALETTE.stoneLight
    roundRect(ctx, spot.x - 48, spot.y - 14, 96, 30, 10)
    this.ring(spot.x, spot.y + 8, 58, 22, affordable)
    this.chargeArc(state, id, spot)
  }

  // the deliberate-buy feedback: a golden arc sweeps the pad while you stand
  // still on it, full circle = bought. no arc ever appears in passing.
  private chargeArc(state: GameState, id: string, spot: Point): void {
    if (state.buyCharge?.id !== id) return
    const ctx = this.context
    const fraction = Math.min(1, state.buyCharge.t / BUY_CHARGE_SECONDS)
    ctx.save()
    ctx.strokeStyle = PALETTE.coin
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.ellipse(spot.x, spot.y + 8, 58, 22, 0, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // the monument grows on the skyline as stages complete: pedestal, base,
  // torso, raised pickaxe, gold trim. stage 0 is a dashed promise.
  private drawMonument(state: GameState): void {
    const ctx = this.context
    const stage = state.save.monument
    const x = MONUMENT.x
    const y = MONUMENT.y
    this.shadow(x, y + 6, 70, 12)
    if (stage === 0) {
      ctx.save()
      ctx.strokeStyle = 'rgba(61,50,48,.45)'
      ctx.lineWidth = 3
      ctx.setLineDash([8, 8])
      ctx.strokeRect(x - 45, y - 120, 90, 118)
      ctx.restore()
    }
    if (stage >= 1) { ctx.fillStyle = PALETTE.stoneLight; roundRect(ctx, x - 55, y - 18, 110, 20, 6) }
    if (stage >= 2) { ctx.fillStyle = '#B9B4AC'; roundRect(ctx, x - 38, y - 52, 76, 36, 8) }
    if (stage >= 3) {
      ctx.fillStyle = '#A9A49C'
      roundRect(ctx, x - 22, y - 100, 44, 50, 12)
      ctx.beginPath(); ctx.arc(x, y - 110, 16, 0, Math.PI * 2); ctx.fill()
    }
    if (stage >= 4) {
      ctx.save()
      ctx.translate(x + 20, y - 96)
      ctx.rotate(-0.6)
      ctx.fillStyle = PALETTE.wood
      roundRect(ctx, -3, -34, 6, 38, 3)
      ctx.fillStyle = '#8D9096'
      ctx.beginPath(); ctx.moveTo(-14, -34); ctx.quadraticCurveTo(0, -44, 14, -34); ctx.quadraticCurveTo(0, -38, -14, -34); ctx.fill()
      ctx.restore()
    }
    if (stage >= MONUMENT_STAGES.length) {
      ctx.fillStyle = PALETTE.coin
      ctx.beginPath(); ctx.arc(x, y - 110, 18, 0, Math.PI * 2); ctx.fill()
      if (!this.reducedMotion) {
        ctx.fillStyle = 'rgba(255,212,94,.8)'
        for (let i = 0; i < 4; i++) {
          const a = state.time * 2 + i * 1.57
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * 58, y - 80 + Math.sin(a) * 34, 4, 0, Math.PI * 2); ctx.fill()
        }
      }
    }
    const next = MONUMENT_STAGES[stage]
    const nearby = Math.hypot(state.player.x - x, state.player.y - y) < 150
    if (next && nearby) this.ring(x, y + 8, 72, 22, state.save.coins > 0)
  }

  private drawHelperPad(state: GameState): void {
    const ctx = this.context
    const spot = HELPER_PAD
    this.shadow(spot.x, spot.y + 14, 56, 13)
    ctx.fillStyle = PALETTE.stoneLight
    roundRect(ctx, spot.x - 48, spot.y - 14, 96, 30, 10)
    const mine = currentMine(state.save)
    const affordable = mine.helpers < HELPER_PRICES.length && state.save.coins >= HELPER_PRICES[mine.helpers] * mineMultiplier(state.save.mine)
    this.ring(spot.x, spot.y + 8, 58, 22, affordable)
    this.chargeArc(state, 'helper', spot)
  }

  // a hired hand: smaller, grey hat, same bones as the miner
  private drawHelper(state: GameState, helper: { x: number; y: number; stack: Ore[] }): void {
    const ctx = this.context
    this.shadow(helper.x, helper.y + 3, 26, 8)
    ctx.save()
    ctx.translate(helper.x, helper.y)
    ctx.fillStyle = '#5A6B8C'
    roundRect(ctx, -12, -22, 10, 22, 5)
    roundRect(ctx, 2, -22, 10, 22, 5)
    ctx.fillStyle = '#7B8A6E'
    roundRect(ctx, -15, -48, 30, 30, 10)
    ctx.fillStyle = '#F2C9A2'
    ctx.beginPath(); ctx.arc(0, -60, 15, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#B8B2A6'
    ctx.beginPath(); ctx.arc(0, -66, 14, Math.PI, 0); ctx.fill()
    ctx.fillStyle = PALETTE.ink
    ctx.beginPath(); ctx.arc(4, -59, 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(10, -59, 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
    for (let i = 0; i < helper.stack.length; i++) {
      this.drawChip(helper.x - 18, helper.y - 28 - i * 9, helper.stack[i])
    }
  }

  // the shaft at the bottom of the world: visible once you can stand near it
  private drawShaft(state: GameState): void {
    const ctx = this.context
    if (currentMine(state.save).gates < GATES.length) return
    const x = TRAVEL.x
    const y = TRAVEL.y
    ctx.fillStyle = 'rgba(20,16,20,.85)'
    ctx.beginPath(); ctx.ellipse(x, y, 92, 34, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = PALETTE.wood
    roundRect(ctx, x - 104, y - 40, 16, 46, 5)
    roundRect(ctx, x + 88, y - 40, 16, 46, 5)
    roundRect(ctx, x - 108, y - 48, 216, 14, 6)
    // ladder disappearing down
    ctx.strokeStyle = '#B5804F'
    ctx.lineWidth = 5
    ctx.beginPath(); ctx.moveTo(x - 18, y - 8); ctx.lineTo(x - 12, y + 26); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x + 18, y - 8); ctx.lineTo(x + 12, y + 26); ctx.stroke()
    for (let rung = 0; rung < 3; rung++) {
      ctx.beginPath(); ctx.moveTo(x - 16 + rung, y + rung * 10); ctx.lineTo(x + 16 - rung, y + rung * 10); ctx.stroke()
    }
    this.ring(x, y, 96, 38, state.save.coins > 0)
  }

  private drawGate(state: GameState, index: number): void {
    const ctx = this.context
    const gatePos = GATES[index]
    if (index < currentMine(state.save).gates) return
    // a horizontal rock-wall floor sealing the stratum below
    ctx.fillStyle = '#6E6A5E'
    roundRect(ctx, 0, gatePos.y - 26, WORLD.width, 52, 0)
    ctx.fillStyle = '#7E796B'
    for (let x = 10; x < WORLD.width; x += 68) {
      roundRect(ctx, x, gatePos.y - 18 + (x % 2) * 8, 52, 26, 10)
    }
  }

  // all interactive text, projected from world anchors but sized in css px
  private worldLabels(state: GameState, view: Viewport, cameraY: number): void {
    const project = (p: Point) => worldToClient(view, { x: p.x, y: p.y - cameraY })
    const onScreen = (c: Point) => c.y > -60 && c.y < view.cssHeight + 60

    const depot = project({ x: DEPOT.x, y: DEPOT.y - 4 })
    if (onScreen(depot)) this.text('SELL', depot.x, depot.y, 16, '#FFF', true)

    const icons: Record<UpgradeId, string> = { pick: '⛏', pack: '🎒', boots: '👢', swing: '💪', reach: '🧲', cart: '🛒' }
    for (const id of Object.keys(SHOP) as UpgradeId[]) {
      const level = state.save.upgrades[id]
      const maxed = level >= upgradeMax(id, state.save.mines.length)
      const price = upgradePrice(id, level)
      const affordable = !maxed && state.save.coins >= price
      const spot = project({ x: SHOP[id].x, y: SHOP[id].y + 2 })
      if (!onScreen(spot)) continue
      this.text(maxed ? `${icons[id]}${level} MAX` : `${icons[id]}${level} · ${price}`, spot.x, spot.y, 13, maxed ? '#6E6A5E' : affordable ? '#1F6B42' : '#A04848', true)
    }

    for (const spot of CHUTES) {
      const at = project({ x: spot.x, y: spot.y - 34 })
      if (onScreen(at)) this.text('CHUTE ↑', at.x, at.y, 13, 'rgba(244,235,221,.9)', true)
    }

    const hire = project({ x: HELPER_PAD.x, y: HELPER_PAD.y + 2 })
    if (onScreen(hire)) {
      const mine = currentMine(state.save)
      const maxed = mine.helpers >= HELPER_PRICES.length
      const price = maxed ? 0 : HELPER_PRICES[mine.helpers] * mineMultiplier(state.save.mine)
      const affordable = !maxed && state.save.coins >= price
      this.text(maxed ? `👷${mine.helpers} MAX` : `👷${mine.helpers} · $${price}`, hire.x, hire.y, 13, maxed ? '#6E6A5E' : affordable ? '#1F6B42' : '#A04848', true)
    }

    // the travel shaft banner: visible once both gates are open in this mine
    if (currentMine(state.save).gates >= GATES.length) {
      const shaft = project({ x: TRAVEL.x, y: TRAVEL.y - 60 })
      if (onScreen(shaft)) {
        const pickLevel = pickDamage(state) - 1
        const needPick = travelPickNeeded(state.save.mine)
        const price = travelPrice(state.save.mine)
        const paid = currentMine(state.save).gatePaid
        const ctx = this.context
        ctx.fillStyle = 'rgba(61,50,48,.88)'
        cssRound(ctx, shaft.x - 100, shaft.y - 18, 200, 46, 12)
        if (pickLevel < needPick) {
          this.text(`NEXT MINE: PICK LV${needPick} NEEDED`, shaft.x, shaft.y + 2, 13, '#F5A9A0', true)
        } else {
          this.text(`NEXT MINE  $${price - paid}`, shaft.x, shaft.y - 1, 14, '#FFD45E', true)
          ctx.fillStyle = 'rgba(255,255,255,.25)'
          cssRound(ctx, shaft.x - 86, shaft.y + 10, 172, 10, 5)
          ctx.fillStyle = PALETTE.coin
          const fill = paid / price
          if (fill > 0) cssRound(ctx, shaft.x - 86, shaft.y + 10, 172 * fill, 10, 5)
        }
      }
    }

    const stagePrice = MONUMENT_STAGES[state.save.monument]
    const monumentNear = Math.hypot(state.player.x - MONUMENT.x, state.player.y - MONUMENT.y) < 150
    if (stagePrice && monumentNear) {
      const spot = project({ x: MONUMENT.x, y: MONUMENT.y - 132 })
      spot.x = Math.max(104, Math.min(view.cssWidth - 104, spot.x)) // never clip an edge
      spot.y = Math.max(150, spot.y) // never sit on the hud stack
      if (onScreen(spot)) {
        const remaining = stagePrice - state.save.monumentPaid
        const fill = state.save.monumentPaid / stagePrice
        const ctx = this.context
        ctx.fillStyle = 'rgba(61,50,48,.85)'
        cssRound(ctx, spot.x - 92, spot.y - 16, 184, 40, 12)
        ctx.fillStyle = 'rgba(255,255,255,.25)'
        cssRound(ctx, spot.x - 82, spot.y + 6, 164, 10, 5)
        ctx.fillStyle = PALETTE.coin
        if (fill > 0) cssRound(ctx, spot.x - 82, spot.y + 6, 164 * fill, 10, 5)
        this.text(`MONUMENT ${state.save.monument + 1}/5  $${remaining}`, spot.x, spot.y, 13, '#FFF', true)
      }
    }

    const mineState = currentMine(state.save)
    const next = GATES[mineState.gates]
    if (next) {
      const gate = project({ x: next.x, y: next.y - 56 })
      if (onScreen(gate)) {
        const price = next.price * mineMultiplier(state.save.mine)
        const remaining = price - mineState.gatePaid
        const fill = mineState.gatePaid / price
        const ctx = this.context
        ctx.fillStyle = 'rgba(61,50,48,.85)'
        cssRound(ctx, gate.x - 88, gate.y - 18, 176, 42, 12)
        ctx.fillStyle = 'rgba(255,255,255,.25)'
        cssRound(ctx, gate.x - 78, gate.y + 6, 156, 12, 6)
        ctx.fillStyle = PALETTE.coin
        if (fill > 0) cssRound(ctx, gate.x - 78, gate.y + 6, 156 * fill, 12, 6)
        this.text(`DIG DEEPER  $${remaining}`, gate.x, gate.y - 1, 14, '#FFF', true)
      }
    }
  }

  private drawHud(state: GameState, view: Viewport): void {
    const ctx = this.context
    const pad = 14
    // coins pill
    ctx.fillStyle = this.tokens.raised
    cssRound(ctx, pad, pad, 132, 40, 20)
    ctx.strokeStyle = this.tokens.ink; ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.roundRect(pad, pad, 132, 40, 20); ctx.stroke()
    coinCss(ctx, pad + 22, pad + 20, 12)
    this.text(String(state.save.coins), pad + 82, pad + 26, 18, this.tokens.ink, true)
    // pack meter
    const full = state.stack.length >= capacity(state)
    ctx.fillStyle = this.tokens.raised
    cssRound(ctx, pad, pad + 48, 132, 32, 16)
    this.text(`⛏ ${state.stack.length}/${capacity(state)}${full ? ' FULL' : ''}`, pad + 66, pad + 69, 14, full ? this.tokens.warn : this.tokens.ink, true)

    // contract card: the goal, top-center, always readable
    const contract = state.save.contract
    if (contract) {
      const width = Math.min(250, view.cssWidth - 300)
      const cx = view.cssWidth / 2 + 30
      if (width > 150) {
        ctx.fillStyle = this.alpha(this.tokens.ink,.86)
        cssRound(ctx, cx - width / 2, pad, width, 62, this.tokens.radius * .875)
        this.text(`DELIVER ${contract.need} ${ORE_LABEL[contract.ore]}`, cx, pad + 20, 14, this.tokens.raised, true)
        ctx.fillStyle = this.alpha(this.tokens.raised,.25)
        cssRound(ctx, cx - width / 2 + 12, pad + 30, width - 24, 10, 5)
        ctx.fillStyle = PALETTE.ore[contract.ore]
        const fill = Math.min(1, contract.done / contract.need)
        if (fill > 0) cssRound(ctx, cx - width / 2 + 12, pad + 30, (width - 24) * fill, 10, 5)
        this.text(`${contract.done}/${contract.need}  ·  BONUS $${contract.reward}`, cx, pad + 54, 13, this.tokens.accent, true)
      } else {
        // very narrow: compact one-line card below the coins
        ctx.fillStyle = this.alpha(this.tokens.ink,.86)
        cssRound(ctx, pad, pad + 88, 210, 30, this.tokens.radius * .75)
        this.text(`${ORE_LABEL[contract.ore]} ${contract.done}/${contract.need} → $${contract.reward}`, pad + 105, pad + 108, 13, this.tokens.accent, true)
      }
    }
    // depth status lives in the top-left column with the other always-on hud:
    // the bottom strip belongs to conditional pills (coach, sound) and the nav
    const contractNarrow = Boolean(state.save.contract) && Math.min(250, view.cssWidth - 300) <= 150
    const depthY = contractNarrow ? pad + 132 : pad + 100
    this.text(`MINE ${state.save.mine + 1} · ZONE ${Math.min(3, currentMine(state.save).gates + 1)}/3`, pad + 60, depthY, 13, this.alpha(this.tokens.ink,.75), true)
    // the first-minute coach: two lessons for a fresh save, advanced by the
    // real actions, drawn in the same hud language as everything else
    if (this.coachStep) {
      ctx.fillStyle = this.alpha(this.tokens.ink,.85)
      cssRound(ctx, view.cssWidth / 2 - 110, view.cssHeight - this.bottomInset - 96, 220, 34, 17)
      this.text(this.coachStep === 'move' ? 'DRAG ANYWHERE TO MOVE' : 'WALK UP TO A ROCK ⛏', view.cssWidth / 2, view.cssHeight - this.bottomInset - 73, 14, this.tokens.accent)
    }
    // sound status, only when something is off: muted or never woken
    const soundState = this.audioState()
    if (soundState !== 'running') {
      ctx.fillStyle = this.alpha(this.tokens.ink,.75)
      cssRound(ctx, view.cssWidth / 2 - 92, view.cssHeight - this.bottomInset - 44, 184, 30, 15)
      this.text(soundState === 'muted' ? 'SOUND OFF 🔇' : 'TAP FOR SOUND 🔊', view.cssWidth / 2, view.cssHeight - this.bottomInset - 24, 13, this.tokens.raised)
    }
  }

  private drawJoystick(joystick: Joystick, view: Viewport, cameraY: number): void {
    const ctx = this.context
    const origin = worldToClient(view, { x: joystick.origin.x, y: joystick.origin.y - cameraY })
    const current = worldToClient(view, { x: joystick.current.x, y: joystick.current.y - cameraY })
    ctx.save()
    ctx.globalAlpha = 0.6
    ctx.fillStyle = '#FFF'
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(origin.x, origin.y, 42, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    const dx = current.x - origin.x
    const dy = current.y - origin.y
    const length = Math.max(1, Math.hypot(dx, dy))
    const reach = Math.min(28, length)
    ctx.fillStyle = PALETTE.coin
    ctx.beginPath(); ctx.arc(origin.x + dx / length * reach, origin.y + dy / length * reach, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.restore()
  }

  private ring(x: number, y: number, rx: number, ry: number, active: boolean): void {
    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = active ? '#1F6B42' : 'rgba(61,50,48,.4)'
    ctx.lineWidth = 4
    ctx.setLineDash([10, 10])
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  /** css-px text with a floor of 13: nothing on screen is ever smaller */
  private text(value: string, x: number, y: number, size: number, color: string, stroke = false): void {
    const ctx = this.context
    const px = Math.max(13, size)
    ctx.font = `800 ${px}px ${this.tokens.font}`
    ctx.textAlign = 'center'
    if (stroke) {
      ctx.lineWidth = px / 5
      ctx.strokeStyle = this.alpha(this.tokens.ink, .35)
      ctx.strokeText(value, x, y)
    }
    ctx.fillStyle = color
    ctx.fillText(value, x, y)
  }

  private shadow(x: number, y: number, rx: number, ry: number): void {
    const ctx = this.context
    ctx.fillStyle = 'rgba(61,50,48,.15)'
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill()
  }
}

function lump(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}

function coin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = PALETTE.coinDeep
  ctx.beginPath(); ctx.arc(x, y + 2, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = PALETTE.coin
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}

function coinCss(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  coin(ctx, x, y, r)
  ctx.fillStyle = PALETTE.coinDeep
  ctx.font = `800 ${r * 1.3}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('$', x, y + r * 0.45)
}

function cssRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, skew = 0): void {
  ctx.save()
  if (skew) ctx.transform(1, 0, skew / 100, 1, 0, 0)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
  ctx.restore()
}

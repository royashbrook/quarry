// quarry's renderer: everything is drawn vector-style in canvas, no image
// assets at all. flat-shaded rounded shapes, y-sorted with the shared depth
// rule, one camera pan for the wide world. reads GameState, never writes it.
import { byDepth, depthScale } from './depth'
import type { GameState, Ore, Point, Rock, UpgradeId } from './engine'
import { capacity, DEPOT, FLOOR, GATES, ORES, SHOP, upgradePrice, UPGRADES, ZONE_W } from './engine'
import type { Viewport } from './viewport'

type Joystick = { active: boolean; origin: Point; current: Point }

export const PALETTE = {
  grass: '#8FCB6B',
  grassFar: '#7ABB5D',
  dirt: '#C9A176',
  path: '#DDBE92',
  ink: '#3D3230',
  sky: '#BDE3F0',
  coin: '#FFD45E',
  coinDeep: '#E2A93B',
  wood: '#9C6B44',
  stoneLight: '#C7C3BD',
  ore: {
    stone: '#A9A49C',
    coal: '#4E4A50',
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

  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas unavailable')
    this.context = context
  }

  draw(state: GameState, joystick: Joystick, view: Viewport, cameraX: number): void {
    const ctx = this.context
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const k = view.dpr * view.scale
    ctx.setTransform(k, 0, 0, k, (-view.originX - cameraX) * k, -view.originY * k)

    this.drawGround(state, view, cameraX)

    const things: { anchor: Point; draw: () => void }[] = [
      { anchor: DEPOT, draw: () => this.drawDepot(state) },
      ...(Object.keys(SHOP) as UpgradeId[]).map(id => ({ anchor: SHOP[id], draw: () => this.drawShopPad(state, id) })),
      ...GATES.map((gatePos, index) => ({ anchor: gatePos, draw: () => this.drawGate(state, index) })),
      ...state.rocks.filter(rock => rock.respawn === 0).map(rock => ({ anchor: rock, draw: () => this.drawRock(state, rock) })),
      { anchor: state.player, draw: () => this.drawMiner(state) },
    ]
    things.sort(byDepth).forEach(item => this.grounded(item.anchor, item.draw))

    state.chips.forEach(chip => this.drawChip(chip.x, chip.y, chip.ore))
    state.floats.forEach(item => this.drawFloat(item.x, item.y, item.text, item.age, item.kind))
    this.drawHud(state, view, cameraX)
    if (joystick.active) this.drawJoystick(joystick, cameraX)
  }

  private grounded(anchor: Point, draw: () => void): void {
    const ctx = this.context
    const scale = depthScale(anchor.y)
    ctx.save()
    ctx.translate(anchor.x, anchor.y)
    ctx.scale(scale, scale)
    ctx.translate(-anchor.x, -anchor.y)
    draw()
    ctx.restore()
  }

  private drawGround(state: GameState, view: Viewport, cameraX: number): void {
    const ctx = this.context
    const left = view.originX + cameraX
    const top = view.originY
    const right = left + view.viewWidth
    const bottom = top + view.viewHeight
    // sky band above the cliff line, then the quarry floor
    ctx.fillStyle = PALETTE.sky
    ctx.fillRect(left, top, view.viewWidth, FLOOR.top - 40 - top)
    ctx.fillStyle = PALETTE.grassFar
    ctx.fillRect(left, FLOOR.top - 40, view.viewWidth, 46)
    ctx.fillStyle = PALETTE.grass
    ctx.fillRect(left, FLOOR.top + 6, view.viewWidth, bottom - FLOOR.top - 6)
    // dirt path along the depot row, receding rows for depth
    ctx.fillStyle = PALETTE.path
    ctx.beginPath(); ctx.ellipse(DEPOT.x, DEPOT.y + 8, 150, 52, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(61,50,48,.07)'
    ctx.lineWidth = 2
    let rowY = FLOOR.top + 14
    let gap = 10
    while (rowY < bottom) {
      ctx.beginPath(); ctx.moveTo(left, rowY); ctx.lineTo(right, rowY); ctx.stroke()
      rowY += gap
      gap *= 1.24
    }
    // grass tufts, fixed pattern so nothing shimmers
    ctx.fillStyle = 'rgba(61,50,48,.06)'
    for (let tx = Math.floor(left / 120) * 120; tx < right; tx += 120) {
      const ty = FLOOR.top + 40 + ((tx * 7919) % 300)
      if (ty < bottom) { ctx.beginPath(); ctx.ellipse(tx, ty, 14, 5, 0, 0, Math.PI * 2); ctx.fill() }
    }
  }

  private drawRock(state: GameState, rock: Rock): void {
    const ctx = this.context
    const wobble = this.reducedMotion ? 0 : Math.sin(rock.wobble * 14) * rock.wobble * 0.06
    const healthy = rock.hp / ORES[rock.ore].hp
    const size = 34 + 14 * healthy // rocks visibly shrink as they chip away
    this.shadow(rock.x, rock.y + 6, size + 10, 12)
    ctx.save()
    ctx.translate(rock.x, rock.y)
    ctx.rotate(wobble)
    // boulder: three overlapping rounded lumps, facet highlight, ore studs
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
    ctx.restore()
  }

  private drawMiner(state: GameState): void {
    const ctx = this.context
    const player = state.player
    const stride = player.moving && !this.reducedMotion ? Math.sin(state.time * 12) : 0
    const bob = Math.abs(stride) * -5
    this.shadow(player.x, player.y + 4, 40, 11)
    ctx.save()
    ctx.translate(player.x, player.y + bob)
    ctx.scale(player.facing, 1)
    // legs
    ctx.fillStyle = '#4A5A78'
    roundRect(ctx, -20, -34, 17, 36, 8, stride * 6)
    roundRect(ctx, 3, -34, 17, 36, 8, -stride * 6)
    // body
    ctx.fillStyle = '#E4863B'
    roundRect(ctx, -25, -78, 50, 52, 16)
    ctx.fillStyle = '#F2B04A'
    roundRect(ctx, -25, -78, 50, 18, 9)
    // head + hard hat + face
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
    // pickaxe arm: swings while mining, rests on the shoulder otherwise
    const swingPhase = player.swinging ? Math.sin((player.swing / 0.55) * Math.PI) : 0
    ctx.save()
    ctx.translate(18, -70)
    ctx.rotate(-0.8 + swingPhase * 1.5)
    ctx.fillStyle = PALETTE.wood
    roundRect(ctx, -4, -46, 8, 50, 4)
    ctx.fillStyle = '#8D9096'
    ctx.beginPath()
    ctx.moveTo(-20, -46); ctx.quadraticCurveTo(0, -60, 20, -46)
    ctx.quadraticCurveTo(0, -50, -20, -46)
    ctx.fill()
    ctx.restore()
    ctx.restore()
    this.drawStack(state)
  }

  // the carried stack rides a backpack frame behind the miner
  private drawStack(state: GameState): void {
    const ctx = this.context
    const player = state.player
    const baseX = player.x - player.facing * 30
    for (let i = 0; i < state.stack.length; i++) {
      const sway = this.reducedMotion ? 0 : Math.sin(state.time * 8 + i * 0.6) * Math.min(6, i)
      this.drawChip(baseX + sway * 0.4, player.y - 44 - i * 11, state.stack[i], 1)
    }
  }

  private drawChip(x: number, y: number, ore: Ore, scale = 1): void {
    const ctx = this.context
    ctx.fillStyle = PALETTE.ore[ore]
    roundRect(ctx, x - 10 * scale, y - 8 * scale, 20 * scale, 16 * scale, 5)
    ctx.fillStyle = 'rgba(255,255,255,.3)'
    roundRect(ctx, x - 6 * scale, y - 6 * scale, 8 * scale, 5 * scale, 2.5)
  }

  private drawDepot(state: GameState): void {
    const ctx = this.context
    this.shadow(DEPOT.x, DEPOT.y + 16, 96, 20)
    // sell pad: a wooden pallet with a big coin sign
    ctx.fillStyle = PALETTE.wood
    roundRect(ctx, DEPOT.x - 85, DEPOT.y - 24, 170, 44, 12)
    ctx.fillStyle = '#B5804F'
    roundRect(ctx, DEPOT.x - 85, DEPOT.y - 24, 170, 14, 7)
    coin(ctx, DEPOT.x - 44, DEPOT.y - 44, 17)
    coin(ctx, DEPOT.x + 44, DEPOT.y - 44, 17)
    this.label('SELL', DEPOT.x, DEPOT.y - 2, 22, '#FFF')
    this.ring(DEPOT.x, DEPOT.y + 12, 92, 34, state.stack.length > 0)
  }

  private drawShopPad(state: GameState, id: UpgradeId): void {
    const ctx = this.context
    const spot = SHOP[id]
    const level = state.save.upgrades[id]
    const maxed = level >= UPGRADES[id].max
    const price = upgradePrice(id, level)
    const affordable = !maxed && state.save.coins >= price
    this.shadow(spot.x, spot.y + 14, 62, 14)
    ctx.fillStyle = PALETTE.stoneLight
    roundRect(ctx, spot.x - 52, spot.y - 14, 104, 30, 10)
    const icon = { pick: '⛏', pack: '🎒', boots: '👢' }[id]
    this.label(icon, spot.x - 30, spot.y - 26, 22, PALETTE.ink)
    this.label(`LV${level}`, spot.x + 18, spot.y - 28, 15, PALETTE.ink)
    if (maxed) {
      this.label('MAX', spot.x, spot.y + 4, 16, PALETTE.ink)
    } else {
      coin(ctx, spot.x - 30, spot.y + 2, 9)
      this.label(String(price), spot.x + 10, spot.y + 4, 17, affordable ? '#2E7D4F' : '#A04848')
    }
    this.ring(spot.x, spot.y + 10, 62, 24, affordable)
  }

  private drawGate(state: GameState, index: number): void {
    const ctx = this.context
    const gatePos = GATES[index]
    if (index < state.save.gates) return // open gates vanish: the way is clear
    const isNext = index === state.save.gates
    const paid = isNext ? state.save.gatePaid : 0
    const price = gatePos.price
    // wall spanning the floor, with a progress door in the middle
    ctx.fillStyle = '#8B8577'
    roundRect(ctx, gatePos.x - 16, FLOOR.top - 60, 32, FLOOR.bottom - FLOOR.top + 90, 10)
    ctx.fillStyle = '#6E6A5E'
    for (let y = FLOOR.top - 40; y < FLOOR.bottom + 10; y += 46) {
      roundRect(ctx, gatePos.x - 16, y, 32, 8, 4)
    }
    if (!isNext) return
    const fill = paid / price
    ctx.fillStyle = 'rgba(61,50,48,.5)'
    roundRect(ctx, gatePos.x - 46, gatePos.y - 96, 92, 26, 13)
    ctx.fillStyle = PALETTE.coin
    if (fill > 0) roundRect(ctx, gatePos.x - 42, gatePos.y - 92, 84 * fill, 18, 9)
    coin(ctx, gatePos.x - 28, gatePos.y - 116, 9)
    this.label(String(price - paid), gatePos.x + 8, gatePos.y - 112, 16, '#FFF')
    this.ring(gatePos.x - 40, gatePos.y + 30, 60, 24, state.save.coins > 0)
  }

  private drawFloat(x: number, y: number, text: string, age: number, kind: 'coin' | 'ore'): void {
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = Math.max(0, 1 - age)
    this.label(text, x, y, kind === 'coin' ? 19 : 16, kind === 'coin' ? '#B8860B' : PALETTE.ink)
    ctx.restore()
  }

  private drawHud(state: GameState, view: Viewport, cameraX: number): void {
    const ctx = this.context
    const x = view.originX + cameraX + 22
    const y = view.originY + 18
    // coins, in digits: this game wears its numbers proudly
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    roundRect(ctx, x, y, 150, 46, 23)
    ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 3
    ctx.beginPath(); ctx.roundRect(x, y, 150, 46, 23); ctx.stroke()
    coin(ctx, x + 26, y + 23, 13)
    this.label(String(state.save.coins), x + 92, y + 30, 22, PALETTE.ink)
    // stack meter
    ctx.fillStyle = 'rgba(255,255,255,.92)'
    roundRect(ctx, x, y + 56, 150, 36, 18)
    this.label(`${state.stack.length}/${capacity(state)}`, x + 75, y + 80, 17, state.stack.length >= capacity(state) ? '#A04848' : PALETTE.ink)
    // zone marker
    this.label(`ZONE ${Math.min(3, state.save.gates + 1)}/3`, x + 75, y + 116, 14, 'rgba(61,50,48,.55)')
  }

  private drawJoystick(joystick: Joystick, cameraX: number): void {
    const ctx = this.context
    ctx.save()
    ctx.globalAlpha = 0.6
    ctx.fillStyle = '#FFF'
    ctx.strokeStyle = PALETTE.ink
    ctx.lineWidth = 4
    ctx.beginPath(); ctx.arc(joystick.origin.x, joystick.origin.y, 46, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    const dx = joystick.current.x - joystick.origin.x
    const dy = joystick.current.y - joystick.origin.y
    const length = Math.max(1, Math.hypot(dx, dy))
    const reach = Math.min(30, length)
    ctx.fillStyle = PALETTE.coin
    ctx.beginPath(); ctx.arc(joystick.origin.x + dx / length * reach, joystick.origin.y + dy / length * reach, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.restore()
  }

  private ring(x: number, y: number, rx: number, ry: number, active: boolean): void {
    const ctx = this.context
    ctx.save()
    ctx.strokeStyle = active ? '#2E7D4F' : 'rgba(61,50,48,.35)'
    ctx.lineWidth = 4
    ctx.setLineDash([10, 10])
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.restore()
  }

  private label(text: string, x: number, y: number, size: number, color: string): void {
    const ctx = this.context
    ctx.fillStyle = color
    ctx.font = `800 ${size}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(text, x, y)
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
  ctx.fillStyle = PALETTE.coinDeep
  ctx.font = `800 ${r * 1.3}px sans-serif`
  ctx.textAlign = 'center'
  ctx.fillText('$', x, y + r * 0.45)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, skew = 0): void {
  ctx.save()
  if (skew) ctx.transform(1, 0, skew / 100, 1, 0, 0)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
  ctx.restore()
}

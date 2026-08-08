// quarry: the pure simulation. mine rocks, stack chunks, sell at the depot,
// buy upgrades, open zone gates. no canvas, no DOM: everything here is
// deterministic and unit-testable. rendering reads this state, never writes it.

export type Point = { x: number; y: number }
export type Input = Point

// ore tiers: value is coins per chunk, hp is swings to exhaust a rock
export type Ore = 'stone' | 'coal' | 'copper' | 'gold' | 'crystal'
export const ORES: Record<Ore, { value: number; hp: number }> = {
  stone: { value: 1, hp: 4 },
  coal: { value: 2, hp: 5 },
  copper: { value: 4, hp: 6 },
  gold: { value: 8, hp: 8 },
  crystal: { value: 20, hp: 10 },
}

export type Rock = {
  id: number
  x: number
  y: number
  ore: Ore
  hp: number
  respawn: number // seconds until back, 0 = alive
  wobble: number // render-only swing feedback, decays
}

export type FloatText = Point & { text: string; age: number; kind: 'coin' | 'ore' }
export type Chip = Point & { vx: number; vy: number; age: number; ore: Ore }

export type UpgradeId = 'pick' | 'pack' | 'boots'
export const UPGRADES: Record<UpgradeId, { base: number; growth: number; max: number }> = {
  pick: { base: 12, growth: 1.7, max: 8 }, // damage per swing
  pack: { base: 10, growth: 1.6, max: 10 }, // carry capacity
  boots: { base: 15, growth: 1.8, max: 6 }, // walk speed
}

export type SaveV1 = {
  version: 1
  coins: number
  upgrades: Record<UpgradeId, number>
  gates: number // how many zone gates are OPEN (zone 0 is free)
  gatePaid: number // coins already poured into the next gate
  lifetime: number
}

export type GameState = {
  time: number
  player: Point & { facing: number; moving: boolean; swing: number; swinging: boolean }
  stack: Ore[]
  rocks: Rock[]
  chips: Chip[]
  floats: FloatText[]
  sellTimer: number
  gateTimer: number
  shopCooldown: number
  save: SaveV1
}

// world: three zones side by side; the camera pans, the sim is one flat plane
export const ZONE_W = 960
export const WORLD = { width: ZONE_W * 3, height: 640 }
export const FLOOR = { top: 205, bottom: 592 }

export const DEPOT = { x: 175, y: 460 }
export const SHOP: Record<UpgradeId, Point> = {
  pick: { x: 90, y: 300 },
  pack: { x: 250, y: 262 },
  boots: { x: 415, y: 240 },
}
export const GATES = [
  { x: ZONE_W - 40, y: 400, price: 150 },
  { x: ZONE_W * 2 - 40, y: 400, price: 900 },
]

// rock formations per zone: laid out by hand so each zone reads as a place
const LAYOUT: [Ore, number, number][] = [
  ['stone', 620, 300], ['stone', 700, 380], ['stone', 780, 300], ['stone', 660, 470],
  ['stone', 810, 450], ['coal', 860, 350], ['coal', 880, 500],
  ['coal', ZONE_W + 140, 320], ['coal', ZONE_W + 240, 420], ['coal', ZONE_W + 180, 520],
  ['copper', ZONE_W + 420, 300], ['copper', ZONE_W + 520, 400], ['copper', ZONE_W + 460, 520],
  ['copper', ZONE_W + 640, 330], ['gold', ZONE_W + 760, 430], ['gold', ZONE_W + 860, 320],
  ['gold', ZONE_W * 2 + 160, 340], ['gold', ZONE_W * 2 + 260, 470],
  ['crystal', ZONE_W * 2 + 440, 320], ['crystal', ZONE_W * 2 + 560, 430],
  ['crystal', ZONE_W * 2 + 680, 320], ['crystal', ZONE_W * 2 + 800, 460],
]

export const defaultSave = (): SaveV1 => ({
  version: 1,
  coins: 0,
  upgrades: { pick: 0, pack: 0, boots: 0 },
  gates: 0,
  gatePaid: 0,
  lifetime: 0,
})

export function createGame(save: SaveV1 = defaultSave()): GameState {
  return {
    time: 0,
    player: { x: 330, y: 430, facing: 1, moving: false, swing: 0, swinging: false },
    stack: [],
    rocks: LAYOUT.map(([ore, x, y], index) => ({ id: index, x, y, ore, hp: ORES[ore].hp, respawn: 0, wobble: 0 })),
    chips: [],
    floats: [],
    sellTimer: 0,
    gateTimer: 0,
    shopCooldown: 0,
    save: structuredClone(save),
  }
}

// derived numbers, all from the save so they survive reload
export const pickDamage = (state: GameState): number => 1 + state.save.upgrades.pick
export const capacity = (state: GameState): number => 8 + state.save.upgrades.pack * 4
export const walkSpeed = (state: GameState): number => 200 + state.save.upgrades.boots * 30
export const swingSeconds = (state: GameState): number => 0.55

export function upgradePrice(id: UpgradeId, level: number): number {
  const rule = UPGRADES[id]
  return Math.round(rule.base * Math.pow(rule.growth, level))
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** The zone a given x sits in; gates block walking past their zone edge. */
export const zoneOf = (x: number): number => Math.floor(x / ZONE_W)

export function step(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  const dt = Math.min(Math.max(seconds, 0), 0.05)
  state.time += dt
  state.shopCooldown = Math.max(0, state.shopCooldown - dt)

  movePlayer(state, dt, input)
  mine(state, dt)
  updateChips(state, dt)
  sell(state, dt)
  shop(state)
  gate(state, dt)
  state.rocks.forEach(rock => {
    rock.wobble = Math.max(0, rock.wobble - dt * 6)
    if (rock.respawn > 0) {
      rock.respawn -= dt
      if (rock.respawn <= 0) { rock.respawn = 0; rock.hp = ORES[rock.ore].hp }
    }
  })
  state.floats.forEach(item => { item.age += dt; item.y -= 28 * dt })
  state.floats = state.floats.filter(item => item.age < 1.1)
}

function movePlayer(state: GameState, dt: number, input: Input): void {
  const length = Math.hypot(input.x, input.y)
  const nx = length > 1 ? input.x / length : input.x
  const ny = length > 1 ? input.y / length : input.y
  state.player.moving = length > 0.05
  if (!state.player.moving) return
  const speed = walkSpeed(state)
  // the world ends at the last OPEN gate: a closed gate is a wall
  const maxX = ZONE_W * (state.save.gates + 1) - 30
  state.player.x = clamp(state.player.x + nx * speed * dt, 40, maxX)
  state.player.y = clamp(state.player.y + ny * speed * 0.72 * dt, FLOOR.top, FLOOR.bottom)
  if (Math.abs(nx) > 0.1) state.player.facing = Math.sign(nx)
}

// standing by a live rock swings automatically; each swing lands one chunk on
// the stack (if there is room) and chips the rock's hp. exhausted rocks respawn.
function mine(state: GameState, dt: number): void {
  const target = state.rocks.find(rock => rock.respawn === 0 && distance(rock, state.player) < 84)
  state.player.swinging = Boolean(target) && state.stack.length < capacity(state)
  if (!target || !state.player.swinging) { state.player.swing = 0; return }
  state.player.swing += dt
  if (state.player.swing < swingSeconds(state)) return
  state.player.swing = 0
  target.wobble = 1
  const damage = Math.min(pickDamage(state), target.hp)
  const chunks = Math.min(damage, capacity(state) - state.stack.length)
  target.hp -= damage
  for (let i = 0; i < chunks; i++) {
    state.stack.push(target.ore)
    state.chips.push({
      x: target.x, y: target.y - 20,
      vx: -40 + (i * 37) % 80, vy: -170 - (i * 23) % 60,
      age: 0, ore: target.ore,
    })
  }
  state.floats.push({ x: target.x, y: target.y - 55, text: `+${chunks}`, age: 0, kind: 'ore' })
  if (target.hp <= 0) target.respawn = 9
}

function updateChips(state: GameState, dt: number): void {
  for (const chip of state.chips) {
    chip.age += dt
    chip.vy += 420 * dt
    chip.x += chip.vx * dt
    chip.y += chip.vy * dt
  }
  state.chips = state.chips.filter(chip => chip.age < 0.75)
}

// the depot drains the stack while you stand on it, one chunk per tick beat
function sell(state: GameState, dt: number): void {
  if (distance(DEPOT, state.player) > 80 || state.stack.length === 0) { state.sellTimer = 0; return }
  state.sellTimer += dt
  if (state.sellTimer < 0.09) return
  state.sellTimer = 0
  const ore = state.stack.pop() as Ore
  const value = ORES[ore].value
  state.save.coins += value
  state.save.lifetime += value
  state.floats.push({ x: DEPOT.x, y: DEPOT.y - 60, text: `+${value}`, age: 0, kind: 'coin' })
}

// shop pads buy instantly when affordable; the cooldown stops a single stand
// from chaining accidental multi-buys
function shop(state: GameState): void {
  if (state.shopCooldown > 0) return
  for (const id of Object.keys(SHOP) as UpgradeId[]) {
    const level = state.save.upgrades[id]
    if (level >= UPGRADES[id].max) continue
    const price = upgradePrice(id, level)
    if (state.save.coins < price || distance(SHOP[id], state.player) > 66) continue
    state.save.coins -= price
    state.save.upgrades[id] = level + 1
    state.shopCooldown = 1
    state.floats.push({ x: SHOP[id].x, y: SHOP[id].y - 60, text: `-${price}`, age: 0, kind: 'coin' })
    return
  }
}

// gates swallow coins over time while you stand at them: progress persists in
// the save, so a half-paid gate stays half-paid across reloads
function gate(state: GameState, dt: number): void {
  const next = GATES[state.save.gates]
  if (!next || state.save.coins === 0 || distance(next, state.player) > 90) { state.gateTimer = 0; return }
  state.gateTimer += dt
  if (state.gateTimer < 0.05) return
  state.gateTimer = 0
  const pour = Math.min(3, state.save.coins, next.price - state.save.gatePaid)
  state.save.coins -= pour
  state.save.gatePaid += pour
  if (state.save.gatePaid >= next.price) {
    state.save.gates += 1
    state.save.gatePaid = 0
    state.floats.push({ x: next.x, y: next.y - 80, text: 'OPEN!', age: 0, kind: 'coin' })
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function runFor(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  for (let left = seconds; left > 0; left -= 0.05) step(state, Math.min(0.05, left), input)
}

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

// a delivery contract: sell `need` chunks of `ore`, collect a fat bonus. the
// rotating goal that gives a session direction and the hud its biggest number.
export type Contract = { ore: Ore; need: number; done: number; reward: number }

export type SaveV1 = {
  version: 1
  coins: number
  upgrades: Record<UpgradeId, number>
  gates: number // how many zone gates are OPEN (zone 0 is free)
  gatePaid: number // coins already poured into the next gate
  lifetime: number
  contract: Contract | null
  contractsDone: number
}

// sound/feel pings for the shell to drain each frame: the engine never touches
// audio, it just says what happened
export type Ping = 'swing' | 'break' | 'coin' | 'buy' | 'gate' | 'contract'
export type Spark = Point & { vx: number; vy: number; age: number }

export type GameState = {
  time: number
  player: Point & { facing: number; moving: boolean; swing: number; swinging: boolean }
  stack: Ore[]
  rocks: Rock[]
  chips: Chip[]
  sparks: Spark[]
  floats: FloatText[]
  shake: number // seconds of screen shake remaining
  pings: Ping[]
  sellTimer: number
  gateTimer: number
  shopCooldown: number
  save: SaveV1
}

// world: portrait-first. one screen wide, three strata DEEP: the surface camp
// sits on top and the player digs downward through coin gates. the camera pans
// vertically.
export const SURFACE = 340
export const ZONE_H = 800
export const WORLD = { width: 540, height: SURFACE + ZONE_H * 3 }

export const DEPOT = { x: 120, y: 240 }
export const SHOP: Record<UpgradeId, Point> = {
  pick: { x: 300, y: 190 },
  pack: { x: 440, y: 240 },
  boots: { x: 360, y: 300 },
}
export const GATES = [
  { x: 270, y: SURFACE + ZONE_H, price: 150 },
  { x: 270, y: SURFACE + ZONE_H * 2, price: 900 },
]

// rock formations per zone: laid out by hand so each zone reads as a place
const LAYOUT: [Ore, number, number][] = [
  ['stone', 120, 480], ['stone', 300, 430], ['stone', 450, 520], ['stone', 180, 640],
  ['stone', 390, 700], ['coal', 100, 820], ['coal', 460, 880], ['coal', 250, 990],
  ['coal', 130, SURFACE + ZONE_H + 90], ['coal', 400, SURFACE + ZONE_H + 140],
  ['copper', 250, SURFACE + ZONE_H + 260], ['copper', 100, SURFACE + ZONE_H + 400],
  ['copper', 430, SURFACE + ZONE_H + 430], ['copper', 300, SURFACE + ZONE_H + 560],
  ['gold', 150, SURFACE + ZONE_H + 660], ['gold', 420, SURFACE + ZONE_H + 720],
  ['gold', 120, SURFACE + ZONE_H * 2 + 100], ['gold', 400, SURFACE + ZONE_H * 2 + 160],
  ['crystal', 250, SURFACE + ZONE_H * 2 + 300], ['crystal', 110, SURFACE + ZONE_H * 2 + 450],
  ['crystal', 430, SURFACE + ZONE_H * 2 + 480], ['crystal', 280, SURFACE + ZONE_H * 2 + 640],
]

export const defaultSave = (): SaveV1 => ({
  version: 1,
  coins: 0,
  upgrades: { pick: 0, pack: 0, boots: 0 },
  gates: 0,
  gatePaid: 0,
  lifetime: 0,
  contract: null,
  contractsDone: 0,
})

// contracts are generated DETERMINISTICALLY from how many came before, so the
// sequence is testable and identical across reloads. deeper zones widen the ore
// pool; need and reward scale gently with count. reward pays double the market
// value, which is the whole reason to chase the listed ore.
export function nextContract(contractsDone: number, gates: number): Contract {
  const pool: Ore[] = (['stone', 'coal'] as Ore[])
    .concat(gates >= 1 ? (['coal', 'copper', 'gold'] as Ore[]) : [])
    .concat(gates >= 2 ? (['gold', 'crystal'] as Ore[]) : [])
  const ore = pool[(contractsDone * 5 + 3) % pool.length]
  const need = 10 + ((contractsDone * 7) % 4) * 5 + gates * 5
  return { ore, need, done: 0, reward: need * ORES[ore].value * 2 }
}

export function createGame(save: SaveV1 = defaultSave()): GameState {
  const state: GameState = {
    time: 0,
    player: { x: 270, y: 430, facing: 1, moving: false, swing: 0, swinging: false },
    stack: [],
    rocks: LAYOUT.map(([ore, x, y], index) => ({ id: index, x, y, ore, hp: ORES[ore].hp, respawn: 0, wobble: 0 })),
    chips: [],
    sparks: [],
    floats: [],
    shake: 0,
    pings: [],
    sellTimer: 0,
    gateTimer: 0,
    shopCooldown: 0,
    save: structuredClone(save),
  }
  if (!state.save.contract) state.save.contract = nextContract(state.save.contractsDone, state.save.gates)
  return state
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

/** The stratum a given depth sits in; gates block digging past their floor. */
export const zoneOf = (y: number): number => Math.max(0, Math.floor((y - SURFACE) / ZONE_H))

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
  state.shake = Math.max(0, state.shake - dt)
  for (const spark of state.sparks) {
    spark.age += dt
    spark.vy += 500 * dt
    spark.x += spark.vx * dt
    spark.y += spark.vy * dt
  }
  state.sparks = state.sparks.filter(spark => spark.age < 0.5)
  if (state.pings.length > 24) state.pings.length = 24 // shell drains these; never grow unbounded
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
  // the world ends at the last OPEN gate: a closed gate is a floor you cannot
  // dig past until it is paid open
  const maxY = SURFACE + ZONE_H * (state.save.gates + 1) - 40
  state.player.x = clamp(state.player.x + nx * speed * dt, 40, WORLD.width - 40)
  state.player.y = clamp(state.player.y + ny * speed * 0.85 * dt, 150, maxY)
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
  state.pings.push('swing')
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
  // impact sparks fly off the strike point, deterministic spread
  for (let i = 0; i < 5; i++) {
    state.sparks.push({ x: target.x, y: target.y - 26, vx: -110 + i * 55, vy: -160 - (i * 31) % 70, age: 0 })
  }
  state.floats.push({ x: target.x, y: target.y - 55, text: `+${chunks}`, age: 0, kind: 'ore' })
  if (target.hp <= 0) {
    target.respawn = 9
    state.shake = 0.28 // the break is the beat that should thump
    state.pings.push('break')
  }
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
  state.pings.push('coin')
  state.floats.push({ x: DEPOT.x, y: DEPOT.y - 60, text: `+${value}`, age: 0, kind: 'coin' })
  // contract progress counts on DELIVERY, so the listed ore is worth the trip
  const contract = state.save.contract
  if (contract && ore === contract.ore) {
    contract.done += 1
    if (contract.done >= contract.need) {
      state.save.coins += contract.reward
      state.save.lifetime += contract.reward
      state.save.contractsDone += 1
      state.floats.push({ x: DEPOT.x, y: DEPOT.y - 96, text: `BONUS +${contract.reward}!`, age: 0, kind: 'coin' })
      state.save.contract = nextContract(state.save.contractsDone, state.save.gates)
      state.shake = 0.2
      state.pings.push('contract')
    }
  }
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
    state.pings.push('buy')
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
    state.shake = 0.4 // the wall coming down is the biggest beat in the game
    state.pings.push('gate')
    state.floats.push({ x: next.x, y: next.y - 80, text: 'OPEN!', age: 0, kind: 'coin' })
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function runFor(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  for (let left = seconds; left > 0; left -= 0.05) step(state, Math.min(0.05, left), input)
}

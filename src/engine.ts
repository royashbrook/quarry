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

export type UpgradeId = 'pick' | 'pack' | 'boots' | 'swing' | 'reach' | 'cart'
export const UPGRADES: Record<UpgradeId, { base: number; growth: number; max: number; stride: number }> = {
  pick: { base: 12, growth: 1.7, max: 8, stride: 4 }, // damage per swing
  pack: { base: 10, growth: 1.6, max: 10, stride: 5 }, // carry capacity
  boots: { base: 15, growth: 1.8, max: 6, stride: 3 }, // walk speed
  swing: { base: 40, growth: 1.8, max: 5, stride: 3 }, // swings come faster
  reach: { base: 60, growth: 1.9, max: 4, stride: 2 }, // mine from farther away
  cart: { base: 80, growth: 1.9, max: 4, stride: 2 }, // chute pays more, travels faster
}

/** every opened mine extends every track: the shop never goes permanently dark */
export function upgradeMax(id: UpgradeId, minesUnlocked: number): number {
  return UPGRADES[id].max + UPGRADES[id].stride * Math.max(0, minesUnlocked - 1)
}

// a delivery contract: sell `need` chunks of `ore`, collect a fat bonus. the
// rotating goal that gives a session direction and the hud its biggest number.
export type Contract = { ore: Ore; need: number; done: number; reward: number }

// one mine's own state: how deep it is opened, and who still works it
export type MineState = { helpers: number; gates: number; gatePaid: number }

export type SaveV2 = {
  version: 2
  coins: number
  upgrades: Record<UpgradeId, number> // gear is global: it travels with you
  lifetime: number
  contract: Contract | null
  contractsDone: number
  monument: number // completed stages, global: the win condition
  monumentPaid: number
  mine: number // which mine you are standing in
  mines: MineState[] // index 0 = the first mine; staffed old mines keep paying
}
export type SaveV1 = {
  version: 1
  coins: number
  upgrades: Record<'pick' | 'pack' | 'boots', number>
  gates: number
  gatePaid: number
  lifetime: number
  contract: Contract | null
  contractsDone: number
  helpers: number
  monument: number
  monumentPaid: number
}

// sound/feel pings for the shell to drain each frame: the engine never touches
// audio, it just says what happened
export type Ping = 'swing' | 'break' | 'coin' | 'buy' | 'gate' | 'contract'
export type Spark = Point & { vx: number; vy: number; age: number }
export type Helper = Point & { stack: Ore[]; rockId: number | null; mineTimer: number; sellTimer: number }
// a chunk riding the rail to the depot: pays out when remaining hits zero
export type Transit = { ore: Ore; remaining: number; total: number; fromY: number }

export type GameState = {
  time: number
  player: Point & { facing: number; moving: boolean; swing: number; swinging: boolean }
  stack: Ore[]
  rocks: Rock[]
  chips: Chip[]
  sparks: Spark[]
  helpers: Helper[]
  transit: Transit[]
  floats: FloatText[]
  shake: number // seconds of screen shake remaining
  pings: Ping[]
  sellTimer: number
  chuteTimer: number
  gateTimer: number
  travelTimer: number
  monumentTimer: number
  // deliberate buying (#4): stand STILL on a pad to charge a purchase; walking
  // through never buys. after a buy the pad latches until you step away.
  buyCharge: { id: string; t: number } | null
  buyLatch: string | null
  save: SaveV2
  passiveBucket: number // fractional passive coins from staffed old mines
}

// world: portrait-first. one screen wide, three strata DEEP: the surface camp
// sits on top and the player digs downward through coin gates. the camera pans
// vertically.
export const SURFACE = 340
export const ZONE_H = 800
export const WORLD = { width: 540, height: SURFACE + ZONE_H * 3 }

export const DEPOT = { x: 100, y: 250 }
// the shop column hugs the right edge in one vertical line: you can reach any
// pad without your path crossing another, and buying is deliberate (see shop())
export const SHOP: Record<UpgradeId, Point> = {
  pick: { x: 462, y: 195 },
  pack: { x: 462, y: 245 },
  boots: { x: 462, y: 295 },
  swing: { x: 462, y: 345 },
  reach: { x: 462, y: 395 },
  cart: { x: 462, y: 445 },
}
// hired auto-miners: they mine and sell WITHOUT you, at half value, and never
// count toward contracts, so playing yourself always beats watching
export const HELPER_PAD: Point = { x: 462, y: 495 }
export const HELPER_PRICES = [100, 400, 1600]
export const HELPER_CAPACITY = 4

// the monument: the long-run coin sink. five build stages poured like a gate,
// standing at its pad, each stage visibly grows the statue on the skyline.
export const MONUMENT: Point = { x: 330, y: 168 }
export const MONUMENT_STAGES = [400, 1200, 3500, 9000, 20000]

export const CHUTES: Point[] = [
  { x: 466, y: 900 },
  { x: 74, y: SURFACE + ZONE_H + 520 },
  { x: 466, y: SURFACE + ZONE_H * 2 + 520 },
]
export const CHUTE_RATE = 0.75
export const RAIL_X = 524

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

export const defaultSave = (): SaveV2 => ({
  version: 2,
  coins: 0,
  upgrades: { pick: 0, pack: 0, boots: 0, swing: 0, reach: 0, cart: 0 },
  lifetime: 0,
  contract: null,
  contractsDone: 0,
  monument: 0,
  monumentPaid: 0,
  mine: 0,
  mines: [{ helpers: 0, gates: 0, gatePaid: 0 }],
})

/** v1 saves carry one implicit mine; fold it into the v2 shape losslessly. */
export function migrateV1(old: SaveV1): SaveV2 {
  return {
    version: 2,
    coins: old.coins,
    upgrades: { swing: 0, reach: 0, cart: 0, ...old.upgrades },
    lifetime: old.lifetime,
    contract: old.contract,
    contractsDone: old.contractsDone,
    monument: old.monument,
    monumentPaid: old.monumentPaid,
    mine: 0,
    mines: [{ helpers: old.helpers, gates: old.gates, gatePaid: old.gatePaid }],
  }
}

/** the mine you are standing in; every gate/helper path reads through this */
export const currentMine = (save: SaveV2): MineState => save.mines[save.mine]

// each deeper mine multiplies ore values, and every price scales to match, so
// the numbers grow but the decisions stay the same shape
export const mineMultiplier = (mine: number): number => Math.pow(3, mine)

// travel: the shaft at the bottom of zone 3. costs coins AND a pick tier, so
// the frontier needs both wealth and equipment.
export const TRAVEL = { x: 270, y: WORLD.height - 70 }
export const travelPrice = (mine: number): number => 1500 * Math.pow(4, mine)
export const travelPickNeeded = (mine: number): number => 3 + mine

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

export function createGame(save: SaveV2 = defaultSave()): GameState {
  const state: GameState = {
    time: 0,
    player: { x: 270, y: 430, facing: 1, moving: false, swing: 0, swinging: false },
    stack: [],
    rocks: LAYOUT.map(([ore, x, y], index) => ({ id: index, x, y, ore, hp: ORES[ore].hp, respawn: 0, wobble: 0 })),
    chips: [],
    sparks: [],
    helpers: [],
    transit: [],
    floats: [],
    shake: 0,
    pings: [],
    sellTimer: 0,
    chuteTimer: 0,
    gateTimer: 0,
    travelTimer: 0,
    monumentTimer: 0,
    buyCharge: null,
    buyLatch: null,
    save: structuredClone(save),
    passiveBucket: 0,
  }
  if (!state.save.contract) state.save.contract = nextContract(state.save.contractsDone, currentMine(state.save).gates)
  for (let i = 0; i < currentMine(state.save).helpers; i++) spawnHelper(state)
  return state
}

// derived numbers, all from the save so they survive reload
export const pickDamage = (state: GameState): number => 1 + state.save.upgrades.pick
export const capacity = (state: GameState): number => 8 + state.save.upgrades.pack * 4
export const walkSpeed = (state: GameState): number => 200 + state.save.upgrades.boots * 30
export const swingSeconds = (state: GameState): number => 0.55 * Math.pow(0.92, state.save.upgrades.swing)
export const mineReach = (state: GameState): number => 84 + state.save.upgrades.reach * 14
export const chuteRate = (state: GameState): number => CHUTE_RATE + state.save.upgrades.cart * 0.05
export const cartSpeedup = (state: GameState): number => 1 + state.save.upgrades.cart * 0.18

export function upgradePrice(id: UpgradeId, level: number): number {
  const rule = UPGRADES[id]
  return Math.round(rule.base * Math.pow(rule.growth, level))
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** The stratum a given depth sits in; gates block digging past their floor. */
export const zoneOf = (y: number): number => Math.max(0, Math.floor((y - SURFACE) / ZONE_H))

export const BUY_CHARGE_SECONDS = 0.7

export function step(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  const dt = Math.min(Math.max(seconds, 0), 0.05)
  state.time += dt

  movePlayer(state, dt, input)
  mine(state, dt)
  updateChips(state, dt)
  sell(state, dt)
  chute(state, dt)
  chargeBuys(state, dt)
  updateTransit(state, dt)
  updateHelpers(state, dt)
  monument(state, dt)
  gate(state, dt)
  travel(state, dt)
  passiveIncome(state, dt)
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
  const maxY = SURFACE + ZONE_H * (currentMine(state.save).gates + 1) - 40
  state.player.x = clamp(state.player.x + nx * speed * dt, 40, WORLD.width - 40)
  state.player.y = clamp(state.player.y + ny * speed * 0.85 * dt, 150, maxY)
  if (Math.abs(nx) > 0.1) state.player.facing = Math.sign(nx)
}

// standing by a live rock swings automatically; each swing lands one chunk on
// the stack (if there is room) and chips the rock's hp. exhausted rocks respawn.
function mine(state: GameState, dt: number): void {
  const target = state.rocks.find(rock => rock.respawn === 0 && distance(rock, state.player) < mineReach(state))
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
  const value = ORES[ore].value * mineMultiplier(state.save.mine)
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
      state.save.contract = nextContract(state.save.contractsDone, currentMine(state.save).gates)
      state.shake = 0.2
      state.pings.push('contract')
    }
  }
}

// stand by a stratum's chute with a stack: chunks drop in one per beat and ride
// the rail up. deeper chutes take longer to pay. never credits contracts.
function chute(state: GameState, dt: number): void {
  const spot = CHUTES.find(candidate => distance(candidate, state.player) < 70)
  if (!spot || state.stack.length === 0) { state.chuteTimer = 0; return }
  state.chuteTimer += dt
  if (state.chuteTimer < 0.12) return
  state.chuteTimer = 0
  const ore = state.stack.pop() as Ore
  const seconds = (1.5 + spot.y / 300) / cartSpeedup(state) // depth = travel time, better carts shave it
  state.transit.push({ ore, remaining: seconds, total: seconds, fromY: spot.y })
  if (state.transit.length > 80) state.transit.shift() // hard cap, oldest pays never: unreachable in play
  state.pings.push('swing')
  state.floats.push({ x: spot.x, y: spot.y - 46, text: '↑', age: 0, kind: 'ore' })
}

function updateTransit(state: GameState, dt: number): void {
  for (const item of state.transit) {
    item.remaining -= dt
    if (item.remaining <= 0) {
      const value = Math.max(1, Math.floor(ORES[item.ore].value * chuteRate(state) * mineMultiplier(state.save.mine)))
      state.save.coins += value
      state.save.lifetime += value
      state.pings.push('coin')
      state.floats.push({ x: DEPOT.x + 40, y: DEPOT.y - 40, text: `+${value}`, age: 0, kind: 'ore' })
    }
  }
  state.transit = state.transit.filter(item => item.remaining > 0)
}

// every purchasable pad, priced and gated in one place for the charge loop
function buyablePads(state: GameState): { id: string; at: Point; price: number; buy: () => void }[] {
  const pads: { id: string; at: Point; price: number; buy: () => void }[] = []
  for (const id of Object.keys(SHOP) as UpgradeId[]) {
    const level = state.save.upgrades[id]
    if (level >= upgradeMax(id, state.save.mines.length)) continue
    pads.push({
      id,
      at: SHOP[id],
      price: upgradePrice(id, level),
      buy: () => { state.save.upgrades[id] = level + 1 },
    })
  }
  const mine = currentMine(state.save)
  if (mine.helpers < HELPER_PRICES.length) {
    pads.push({
      id: 'helper',
      at: HELPER_PAD,
      price: HELPER_PRICES[mine.helpers] * mineMultiplier(state.save.mine),
      buy: () => { mine.helpers += 1; spawnHelper(state) },
    })
  }
  return pads
}

// stand still on an affordable pad: a ring charges for BUY_CHARGE_SECONDS and
// then the purchase happens, once. walking resets the charge; walking THROUGH
// a pad never buys anything. the latch stops a held stand from chain-buying:
// you must step off the pad before it will charge again.
function chargeBuys(state: GameState, dt: number): void {
  // NEAREST pad, and you must be ON it (the column packs pads 50 apart, so a
  // generous radius would let one pad's stand buy its neighbor)
  const pad = buyablePads(state)
    .filter(candidate => distance(candidate.at, state.player) < 26 && state.save.coins >= candidate.price)
    .sort((a, b) => distance(a.at, state.player) - distance(b.at, state.player))[0]
  if (state.buyLatch && (!pad || pad.id !== state.buyLatch)) state.buyLatch = null
  if (!pad || state.player.moving || pad.id === state.buyLatch) { state.buyCharge = null; return }
  if (state.buyCharge?.id !== pad.id) state.buyCharge = { id: pad.id, t: 0 }
  state.buyCharge.t += dt
  if (state.buyCharge.t < BUY_CHARGE_SECONDS) return
  state.buyCharge = null
  state.buyLatch = pad.id
  state.save.coins -= pad.price
  pad.buy()
  state.pings.push('buy')
  state.floats.push({ x: pad.at.x, y: pad.at.y - 60, text: `-${pad.price}`, age: 0, kind: 'coin' })
}

// gates swallow coins over time while you stand at them: progress persists in
// the save, so a half-paid gate stays half-paid across reloads
function gate(state: GameState, dt: number): void {
  const mine = currentMine(state.save)
  const next = GATES[mine.gates]
  if (!next || state.save.coins === 0 || distance(next, state.player) > 90) { state.gateTimer = 0; return }
  const price = next.price * mineMultiplier(state.save.mine)
  state.gateTimer += dt
  if (state.gateTimer < 0.05) return
  state.gateTimer = 0
  const pour = Math.min(3 * mineMultiplier(state.save.mine), state.save.coins, price - mine.gatePaid)
  state.save.coins -= pour
  mine.gatePaid += pour
  if (mine.gatePaid >= price) {
    mine.gates += 1
    mine.gatePaid = 0
    state.shake = 0.4 // the wall coming down is the biggest beat in the game
    state.pings.push('gate')
    state.floats.push({ x: next.x, y: next.y - 80, text: 'OPEN!', age: 0, kind: 'coin' })
  }
}

// the shaft at the very bottom: pour coins with the pick tier in hand, and the
// next mine opens. your helpers stay behind and keep the old mine paying.
function travel(state: GameState, dt: number): void {
  const mine = currentMine(state.save)
  if (mine.gates < GATES.length) return // the shaft sits below the last stratum
  if (pickDamage(state) - 1 < travelPickNeeded(state.save.mine)) return
  if (state.save.coins === 0 || distance(TRAVEL, state.player) > 90) { state.travelTimer = 0; return }
  const price = travelPrice(state.save.mine)
  state.travelTimer += dt
  if (state.travelTimer < 0.05) return
  state.travelTimer = 0
  const pour = Math.min(5 * mineMultiplier(state.save.mine), state.save.coins, price - mine.gatePaid)
  state.save.coins -= pour
  mine.gatePaid += pour
  if (mine.gatePaid >= price) {
    mine.gatePaid = 0
    state.save.mine += 1
    state.save.mines.push({ helpers: 0, gates: 0, gatePaid: 0 })
    state.helpers = [] // the crew stays home; the new mine starts empty
    state.rocks.forEach(rock => { rock.hp = ORES[rock.ore].hp; rock.respawn = 0 })
    state.stack = []
    state.transit = []
    state.player.x = 270
    state.player.y = 430
    state.shake = 0.5
    state.pings.push('gate')
    state.floats.push({ x: 270, y: 500, text: `MINE ${state.save.mine + 1}!`, age: 0, kind: 'coin' })
  }
}

// staffed old mines trickle passive income: each helper left behind earns a
// fraction of its mine's coal-rate. fractions bank in a bucket so nothing is
// lost to rounding; payouts float at the depot so the income is visible.
function passiveIncome(state: GameState, dt: number): void {
  let rate = 0
  for (let m = 0; m < state.save.mine; m++) {
    rate += state.save.mines[m].helpers * mineMultiplier(m) * 0.4
  }
  if (rate === 0) return
  state.passiveBucket += rate * dt
  if (state.passiveBucket < 5) return
  const pay = Math.floor(state.passiveBucket)
  state.passiveBucket -= pay
  state.save.coins += pay
  state.save.lifetime += pay
  state.floats.push({ x: DEPOT.x + 30, y: DEPOT.y - 70, text: `+${pay} MINES`, age: 0, kind: 'ore' })
}

function spawnHelper(state: GameState): void {
  state.helpers.push({ x: DEPOT.x + 40 + state.helpers.length * 20, y: DEPOT.y + 40, stack: [], rockId: null, mineTimer: 0, sellTimer: 0 })
}


// helpers walk to the nearest live rock in the open world, chip one chunk at a
// time into a small stack, then walk it to the depot and sell at HALF value.
// they never touch contracts: the listed ore stays the player's business.
function updateHelpers(state: GameState, dt: number): void {
  const maxY = SURFACE + ZONE_H * (currentMine(state.save).gates + 1) - 40
  for (const helper of state.helpers) {
    if (helper.stack.length >= HELPER_CAPACITY) {
      walkToward(helper, DEPOT, 120 * dt)
      if (distance(helper, DEPOT) < 60) {
        helper.sellTimer += dt
        if (helper.sellTimer >= 0.2) {
          helper.sellTimer = 0
          const ore = helper.stack.pop() as Ore
          const value = Math.max(1, Math.floor(ORES[ore].value * mineMultiplier(state.save.mine) / 2))
          state.save.coins += value
          state.save.lifetime += value
          state.floats.push({ x: DEPOT.x, y: DEPOT.y - 40, text: `+${value}`, age: 0, kind: 'ore' })
        }
      }
      continue
    }
    const target = helper.rockId !== null ? state.rocks[helper.rockId] : null
    if (!target || target.respawn > 0 || target.y > maxY) {
      helper.rockId = nearestLiveRock(state, helper, maxY)
      continue
    }
    if (distance(helper, target) > 70) {
      walkToward(helper, target, 120 * dt)
      continue
    }
    helper.mineTimer += dt
    if (helper.mineTimer < 1.4) continue
    helper.mineTimer = 0
    target.wobble = 1
    target.hp -= 1
    helper.stack.push(target.ore)
    if (target.hp <= 0) target.respawn = 9
  }
}

function nearestLiveRock(state: GameState, from: Point, maxY: number): number | null {
  let best: number | null = null
  let bestDistance = Infinity
  for (const rock of state.rocks) {
    if (rock.respawn > 0 || rock.y > maxY) continue
    const d = distance(rock, from)
    if (d < bestDistance) { bestDistance = d; best = rock.id }
  }
  return best
}

function walkToward(who: Point, to: Point, span: number): void {
  const dx = to.x - who.x
  const dy = to.y - who.y
  const length = Math.max(1, Math.hypot(dx, dy))
  who.x += dx / length * span
  who.y += dy / length * span
}

// the monument pours like a gate: stand at the pad, coins flow into the stage
function monument(state: GameState, dt: number): void {
  const stagePrice = MONUMENT_STAGES[state.save.monument]
  if (!stagePrice || state.save.coins === 0 || distance(MONUMENT, state.player) > 70) { state.monumentTimer = 0; return }
  state.monumentTimer += dt
  if (state.monumentTimer < 0.05) return
  state.monumentTimer = 0
  const pour = Math.min(4, state.save.coins, stagePrice - state.save.monumentPaid)
  state.save.coins -= pour
  state.save.monumentPaid += pour
  if (state.save.monumentPaid >= stagePrice) {
    state.save.monument += 1
    state.save.monumentPaid = 0
    state.shake = 0.4
    state.pings.push('contract')
    state.floats.push({ x: MONUMENT.x, y: MONUMENT.y - 60, text: `STAGE ${state.save.monument}!`, age: 0, kind: 'coin' })
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function runFor(state: GameState, seconds: number, input: Input = { x: 0, y: 0 }): void {
  for (let left = seconds; left > 0; left -= 0.05) step(state, Math.min(0.05, left), input)
}

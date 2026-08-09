import { describe, expect, it } from 'vitest'
import {
  capacity, CHUTE_RATE, CHUTES, createGame, currentMine, DEPOT, GATES, migrateV1, mineMultiplier, TRAVEL, travelPrice, HELPER_PAD, HELPER_PRICES, MONUMENT, MONUMENT_STAGES, nextContract, ORES, pickDamage, runFor, SHOP, SURFACE, ZONE_H,
  buyUpgrade, chuteRate, hireHelperNow, mineReach, swingSeconds, upgradeMax, upgradePrice, walkSpeed, zoneOf,
} from './engine'
import { decodeSave, loadSave, storeSave } from './save'

const memory = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('mining', () => {
  it('standing by a rock swings and stacks chunks', () => {
    const game = createGame()
    const rock = game.rocks[0]
    game.player.x = rock.x - 40
    game.player.y = rock.y
    runFor(game, 3)
    expect(game.stack.length).toBeGreaterThan(0)
    expect(game.stack.every(ore => ore === rock.ore)).toBe(true)
  })

  it('never stacks past capacity', () => {
    const game = createGame()
    const rock = game.rocks[0]
    game.player.x = rock.x - 40
    game.player.y = rock.y
    runFor(game, 60)
    expect(game.stack.length).toBeLessThanOrEqual(capacity(game))
  })

  it('an exhausted rock respawns with full hp', () => {
    const game = createGame()
    const rock = game.rocks[0]
    game.player.x = rock.x - 40
    game.player.y = rock.y
    runFor(game, 8) // plenty to exhaust a 4hp stone at 1 damage
    expect(rock.respawn).toBeGreaterThan(0)
    // step away first: an adjacent player would legally re-mine the respawn
    game.player.x = DEPOT.x
    game.player.y = DEPOT.y
    runFor(game, 10, { x: 0, y: 0 })
    expect(rock.respawn).toBe(0)
    expect(rock.hp).toBe(ORES.stone.hp)
  })
})

describe('selling', () => {
  it('drains the stack into coins at ore value', () => {
    const game = createGame()
    game.stack = ['stone', 'stone', 'gold']
    Object.assign(game.player, DEPOT)
    runFor(game, 2)
    expect(game.stack.length).toBe(0)
    expect(game.save.coins).toBe(1 + 1 + 8)
    expect(game.save.lifetime).toBe(10)
  })
})

describe('shop (deliberate buys, #4)', () => {
  it('standing still charges for ~0.7s and buys exactly once', () => {
    const game = createGame()
    game.save.coins = upgradePrice('pick', 0)
    Object.assign(game.player, SHOP.pick)
    runFor(game, 0.5) // not charged yet
    expect(game.save.upgrades.pick).toBe(0)
    runFor(game, 0.5)
    expect(game.save.upgrades.pick).toBe(1)
    expect(game.save.coins).toBe(0)
  })

  it('WALKING THROUGH a pad never buys, no matter how affordable', () => {
    const game = createGame()
    game.save.coins = 99999
    // march straight down the shop column, crossing every pad
    game.player.x = SHOP.pick.x
    game.player.y = SHOP.pick.y - 80
    runFor(game, 3, { x: 0, y: 1 })
    expect(game.save.upgrades).toEqual({ pick: 0, pack: 0, boots: 0, swing: 0, reach: 0, cart: 0 })
    expect(currentMine(game.save).helpers).toBe(0)
    expect(game.save.coins).toBe(99999)
  })

  it('a held stand cannot chain-buy: the pad latches until you step away', () => {
    const game = createGame()
    game.save.coins = 99999
    Object.assign(game.player, SHOP.pick)
    runFor(game, 2) // one charge completes, then the latch holds
    expect(game.save.upgrades.pick).toBe(1)
    runFor(game, 5) // keep standing: nothing more
    expect(game.save.upgrades.pick).toBe(1)
    // step away, come back: charges again for the next level
    game.player.y += 200
    runFor(game, 0.5)
    Object.assign(game.player, SHOP.pick)
    runFor(game, 1)
    expect(game.save.upgrades.pick).toBe(2)
  })

  it('upgrades change the derived numbers', () => {
    const game = createGame()
    const base = { pick: pickDamage(game), pack: capacity(game), boots: walkSpeed(game) }
    game.save.upgrades = { pick: 2, pack: 2, boots: 2, swing: 0, reach: 0, cart: 0 }
    expect(pickDamage(game)).toBe(base.pick + 2)
    expect(capacity(game)).toBe(base.pack + 8)
    expect(walkSpeed(game)).toBe(base.boots + 60)
  })

  it('prices grow geometrically and stop at max level', () => {
    expect(upgradePrice('pick', 1)).toBeGreaterThan(upgradePrice('pick', 0))
    const game = createGame()
    game.save.upgrades.pick = 8 // max
    game.save.coins = 99999
    Object.assign(game.player, SHOP.pick)
    runFor(game, 3)
    expect(game.save.upgrades.pick).toBe(8)
    expect(game.save.coins).toBe(99999)
  })
})

describe('gates', () => {
  it('a closed gate is a floor you cannot dig past', () => {
    const game = createGame()
    game.player.x = 270
    game.player.y = SURFACE + ZONE_H - 160
    runFor(game, 5, { x: 0, y: 1 })
    expect(game.player.y).toBeLessThanOrEqual(SURFACE + ZONE_H - 40)
    expect(zoneOf(game.player.y)).toBe(0)
  })

  it('pours coins over time, persists partial progress, opens at the price', () => {
    const game = createGame()
    game.save.coins = 60
    Object.assign(game.player, GATES[0])
    runFor(game, 2)
    expect(game.save.coins).toBe(0)
    expect(currentMine(game.save).gatePaid).toBe(60)
    expect(currentMine(game.save).gates).toBe(0)
    game.save.coins = GATES[0].price - 60
    runFor(game, 4)
    expect(currentMine(game.save).gates).toBe(1)
    expect(currentMine(game.save).gatePaid).toBe(0)
  })

  it('an open gate lets the player dig into the next stratum', () => {
    const game = createGame()
    game.save.mines[0].gates = 1
    game.player.x = 270
    game.player.y = SURFACE + ZONE_H - 160
    runFor(game, 6, { x: 0, y: 1 })
    expect(zoneOf(game.player.y)).toBe(1)
  })
})

describe('contracts', () => {
  it('a fresh game carries a zone-1 contract with a double-value reward', () => {
    const game = createGame()
    const contract = game.save.contract!
    expect(['stone', 'coal']).toContain(contract.ore)
    expect(contract.reward).toBe(contract.need * ORES[contract.ore].value * 2)
    expect(contract.done).toBe(0)
  })

  it('is deterministic: same count and gates, same contract', () => {
    expect(nextContract(3, 1)).toEqual(nextContract(3, 1))
    expect(nextContract(4, 1)).not.toEqual(nextContract(3, 1))
  })

  it('deeper zones widen the ore pool', () => {
    const ores = new Set<string>()
    for (let i = 0; i < 12; i++) ores.add(nextContract(i, 2).ore)
    expect([...ores].some(ore => ore === 'gold' || ore === 'crystal')).toBe(true)
  })

  it('progress counts only the listed ore at delivery, completion pays and rolls over', () => {
    const game = createGame()
    game.save.contract = { ore: 'stone', need: 2, done: 0, reward: 4 }
    game.stack = ['coal', 'stone', 'stone']
    Object.assign(game.player, DEPOT)
    runFor(game, 2)
    // 2 stone delivered completes it; coal sold but did not count
    expect(game.save.contractsDone).toBe(1)
    expect(game.save.coins).toBe(1 + 1 + 2 + 4) // stone x2 + coal + bonus
    expect(game.save.contract!.done).toBe(0) // a fresh contract rolled in
  })

  it('feel events queue as pings and never grow unbounded', () => {
    const game = createGame()
    const rock = game.rocks[0]
    game.player.x = rock.x - 40
    game.player.y = rock.y
    runFor(game, 30)
    expect(game.pings.length).toBeLessThanOrEqual(24)
    expect(game.pings).toContain('swing')
  })
})

describe('helpers', () => {
  it('hires with the same charge-and-latch as any pad, capped at three', () => {
    const game = createGame()
    game.save.coins = HELPER_PRICES[0]
    Object.assign(game.player, HELPER_PAD)
    runFor(game, 1)
    expect(currentMine(game.save).helpers).toBe(1)
    expect(game.helpers.length).toBe(1)
    expect(game.save.coins).toBe(0)
    game.save.coins = 99999
    const away = () => { game.player.y += 200; runFor(game, 0.3); Object.assign(game.player, HELPER_PAD) }
    away(); runFor(game, 1) // hire #2
    away(); runFor(game, 1) // hire #3
    away(); runFor(game, 2) // capped: nothing
    expect(currentMine(game.save).helpers).toBe(3)
    expect(game.save.coins).toBe(99999 - HELPER_PRICES[1] - HELPER_PRICES[2])
  })

  it('a helper mines and sells at half value without touching the contract', () => {
    const game = createGame()
    game.save.contract = { ore: 'stone', need: 5, done: 0, reward: 10 }
    game.save.mines[0].helpers = 1
    game.helpers.push({ x: DEPOT.x, y: DEPOT.y, stack: [], rockId: null, mineTimer: 0, sellTimer: 0 })
    // park the player far away so only the helper acts
    game.player.x = 500; game.player.y = 900
    runFor(game, 60)
    expect(game.save.coins).toBeGreaterThan(0)
    expect(game.save.contract.done).toBe(0)
  })

  it('reload respawns the hired helpers', () => {
    const game = createGame()
    game.save.mines[0].helpers = 2
    const reborn = createGame(game.save)
    expect(reborn.helpers.length).toBe(2)
  })
})

describe('monument', () => {
  it('pours coins by stage, grows, and persists partial progress', () => {
    const game = createGame()
    game.save.coins = 150
    Object.assign(game.player, MONUMENT)
    runFor(game, 3)
    expect(game.save.coins).toBe(0)
    expect(game.save.monumentPaid).toBe(150)
    expect(game.save.monument).toBe(0)
    game.save.coins = MONUMENT_STAGES[0] - 150
    runFor(game, 5)
    expect(game.save.monument).toBe(1)
    expect(game.save.monumentPaid).toBe(0)
  })

  it('stops forever after the last stage', () => {
    const game = createGame()
    game.save.monument = MONUMENT_STAGES.length
    game.save.coins = 500
    Object.assign(game.player, MONUMENT)
    runFor(game, 2)
    expect(game.save.coins).toBe(500)
  })
})

describe('save', () => {
  it('round trips storage with upgrades, gates, and partial gate progress', () => {
    const game = createGame()
    game.save.coins = 42
    game.save.upgrades.pack = 3
    game.save.mines[0].gates = 1
    currentMine(game.save).gatePaid = 77
    const storage = memory()
    storeSave(game.save, storage)
    const back = loadSave(storage)
    expect(back).toEqual(game.save)
  })

  it('round trips the qy1 code and rejects garbage', async () => {
    const game = createGame()
    game.save.coins = 500
    currentMine(game.save).gates = 2
    const { encodeSave } = await import('./save')
    const code = await encodeSave(game.save)
    expect(code.startsWith('qy1.')).toBe(true)
    expect(await decodeSave(code)).toEqual(game.save)
    await expect(decodeSave('nope')).rejects.toThrow()
  })
})

describe('ore chute (#7)', () => {
  it('drains the stack into transit and pays discounted at the depot after the delay', () => {
    const game = createGame()
    game.stack = ['gold', 'gold', 'gold', 'gold']
    game.rocks.forEach(rock => { rock.respawn = 99 }) // no mining during the dump
    Object.assign(game.player, CHUTES[0])
    runFor(game, 1)
    expect(game.stack.length).toBe(0)
    expect(game.transit.length).toBe(4)
    expect(game.save.coins).toBe(0) // nothing pays until the cart arrives
    runFor(game, 8) // travel time for zone 1 is ~4.5s
    expect(game.transit.length).toBe(0)
    expect(game.save.coins).toBe(4 * Math.floor(8 * CHUTE_RATE)) // gold 8 -> 6 each
  })

  it('credits the contract on arrival: gathered is gathered (roy, #16)', () => {
    const game = createGame()
    game.save.contract = { ore: 'stone', need: 3, done: 0, reward: 6 }
    game.stack = ['stone', 'stone', 'stone']
    game.rocks.forEach(rock => { rock.respawn = 99 })
    Object.assign(game.player, CHUTES[0])
    runFor(game, 12)
    // all three arrived: contract completed, bonus paid, fresh contract rolled
    expect(game.save.contractsDone).toBe(1)
    expect(game.save.coins).toBe(3 * 1 + 6) // discounted stone still floors to 1, plus bonus
  })

  it('menu purchases work from anywhere via the engine api', () => {
    const game = createGame()
    game.player.x = 270; game.player.y = 2000 // deep underground, nowhere near a pad
    game.save.coins = upgradePrice('pick', 0) + 5 // not enough for level 2 at 20
    expect(buyUpgrade(game, 'pick')).toBe(true)
    expect(game.save.upgrades.pick).toBe(1)
    expect(buyUpgrade(game, 'pick')).toBe(false) // cannot afford level 2
    game.save.coins = 99999
    expect(hireHelperNow(game)).toBe(true)
    expect(currentMine(game.save).helpers).toBe(1)
    expect(game.helpers.length).toBe(1)
  })

  it('deeper chutes take longer to pay', () => {
    const shallow = createGame()
    shallow.stack = ['stone']
    Object.assign(shallow.player, CHUTES[0])
    runFor(shallow, 0.3)
    const deep = createGame()
    deep.stack = ['stone']
    Object.assign(deep.player, CHUTES[2])
    runFor(deep, 0.3)
    expect(deep.transit[0].total).toBeGreaterThan(shallow.transit[0].total)
  })
})

describe('next mine (#5)', () => {
  const readyToTravel = () => {
    const game = createGame()
    game.save.mines[0].gates = 2
    game.save.upgrades.pick = 3 // travel tier for mine 0
    Object.assign(game.player, TRAVEL)
    return game
  }

  it('the shaft refuses a weak pick no matter the money', () => {
    const game = readyToTravel()
    game.save.upgrades.pick = 2
    game.save.coins = 999999
    runFor(game, 3)
    expect(game.save.mine).toBe(0)
    expect(game.save.coins).toBe(999999)
  })

  it('pours coins, then opens mine 2: crew stays, world resets, prices scale', () => {
    const game = readyToTravel()
    game.save.mines[0].helpers = 2
    game.save.coins = travelPrice(0)
    runFor(game, 25)
    expect(game.save.mine).toBe(1)
    expect(game.save.mines.length).toBe(2)
    expect(game.save.mines[0].helpers).toBe(2) // the crew stayed home
    expect(game.save.mines[1]).toEqual({ helpers: 0, gates: 0, gatePaid: 0 })
    expect(game.helpers.length).toBe(0)
    expect(game.player.y).toBe(430) // back at the new surface
    // richer ground: the same stone sells for triple. stop the old crew's
    // trickle and measure the delta so passive income cannot pollute the read.
    game.save.mines[0].helpers = 0
    const coinsBefore = game.save.coins
    game.stack = ['stone']
    Object.assign(game.player, DEPOT)
    runFor(game, 1)
    expect(game.save.coins - coinsBefore).toBe(mineMultiplier(1) * ORES.stone.value)
  })

  it('staffed old mines trickle passive income while you dig the new one', () => {
    const game = readyToTravel()
    game.save.mines[0].helpers = 3
    game.save.coins = travelPrice(0)
    runFor(game, 25) // travels
    expect(game.save.mine).toBe(1)
    const before = game.save.coins
    game.player.x = 270; game.player.y = 600 // away from everything
    game.rocks.forEach(rock => { rock.respawn = 99 })
    runFor(game, 30)
    expect(game.save.coins).toBeGreaterThan(before) // 3 helpers * .4/s ≈ 36 coins
  })

  it('v1 saves migrate losslessly into the one-mine v2 shape', () => {
    const v1 = {
      version: 1 as const, coins: 77, upgrades: { pick: 2, pack: 1, boots: 0 },
      gates: 1, gatePaid: 40, lifetime: 500, contract: null, contractsDone: 3,
      helpers: 2, monument: 1, monumentPaid: 100,
    }
    const v2 = migrateV1(v1)
    expect(v2.version).toBe(2)
    expect(v2.coins).toBe(77)
    expect(v2.mines).toEqual([{ helpers: 2, gates: 1, gatePaid: 40 }])
    expect(v2.monument).toBe(1)
    const game = createGame(v2)
    expect(currentMine(game.save).gates).toBe(1)
    expect(game.helpers.length).toBe(2)
  })
})

describe('pours survive real frame cadence (the 60fps regression)', () => {
  // the travel shaft was dead on real phones: gate() zeroed the shared timer
  // every frame, and only the test harness's fixed 50ms steps masked it. this
  // steps at a real 60fps cadence, which any pour mechanic must survive.
  const runFrames = (game: ReturnType<typeof createGame>, seconds: number) => {
    const dt = 1 / 60
    for (let t = 0; t < seconds; t += dt) runFor(game, dt)
  }

  it('the shaft pours at 60fps', () => {
    const game = createGame()
    game.save.mines[0].gates = 2
    game.save.upgrades.pick = 3
    game.save.coins = 500
    Object.assign(game.player, TRAVEL)
    runFrames(game, 3)
    expect(game.save.mines[0].gatePaid).toBeGreaterThan(0)
  })

  it('gates and the monument still pour at 60fps', () => {
    const gateGame = createGame()
    gateGame.save.coins = 50
    Object.assign(gateGame.player, GATES[0])
    runFrames(gateGame, 2)
    expect(gateGame.save.mines[0].gatePaid).toBeGreaterThan(0)

    const monumentGame = createGame()
    monumentGame.save.coins = 50
    Object.assign(monumentGame.player, MONUMENT)
    runFrames(monumentGame, 2)
    expect(monumentGame.save.monumentPaid).toBeGreaterThan(0)
  })
})

describe('the living shop (#14)', () => {
  it('every opened mine extends every max, so travel revives the shop', () => {
    expect(upgradeMax('pick', 1)).toBe(8)
    expect(upgradeMax('pick', 2)).toBe(12)
    expect(upgradeMax('swing', 3)).toBe(5 + 6)
  })

  it('a maxed-for-mine-one pad reopens after travel', () => {
    const game = createGame()
    game.save.upgrades.pick = 8 // mine-1 max
    game.save.coins = 999999
    Object.assign(game.player, SHOP.pick)
    runFor(game, 2)
    expect(game.save.upgrades.pick).toBe(8) // still capped
    game.save.mines.push({ helpers: 0, gates: 0, gatePaid: 0 }) // opened mine 2
    game.player.y += 200; runFor(game, 0.3)
    Object.assign(game.player, SHOP.pick)
    runFor(game, 2)
    expect(game.save.upgrades.pick).toBe(9) // the shop lives again
  })

  it('the new tracks change how the game plays, not just numbers', () => {
    const game = createGame()
    const baseSwing = swingSeconds(game)
    const baseReach = mineReach(game)
    const baseRate = chuteRate(game)
    game.save.upgrades.swing = 3
    game.save.upgrades.reach = 2
    game.save.upgrades.cart = 2
    expect(swingSeconds(game)).toBeLessThan(baseSwing)
    expect(mineReach(game)).toBe(baseReach + 28)
    expect(chuteRate(game)).toBeCloseTo(baseRate + 0.1)
  })

  it('reach actually mines a rock the base radius cannot touch', () => {
    const game = createGame()
    const rock = game.rocks[0]
    game.player.x = rock.x - 100 // outside base 84, inside 84+28
    game.player.y = rock.y
    runFor(game, 3)
    expect(game.stack.length).toBe(0)
    game.save.upgrades.reach = 2
    runFor(game, 3)
    expect(game.stack.length).toBeGreaterThan(0)
  })
})

describe('contract variety (#roy: stuck on copper)', () => {
  it('visits every ore in the pool instead of parking on one', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 10; n++) seen.add(nextContract(n, 1).ore)
    expect(seen.size).toBeGreaterThanOrEqual(4) // old stride served copper 10/10
  })

  it('mine 2 contracts never ask for stone errands and scale their asks', () => {
    const ores = new Set<string>()
    for (let n = 0; n < 14; n++) {
      const contract = nextContract(n, 0, 1) // fresh mine 2: gates closed
      ores.add(contract.ore)
      expect(contract.need).toBeGreaterThanOrEqual(25)
    }
    expect([...ores].some(ore => ore === 'gold' || ore === 'crystal')).toBe(true)
  })
})

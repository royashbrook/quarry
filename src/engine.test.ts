import { describe, expect, it } from 'vitest'
import {
  capacity, createGame, DEPOT, GATES, HELPER_PAD, HELPER_PRICES, MONUMENT, MONUMENT_STAGES, nextContract, ORES, pickDamage, runFor, SHOP, SURFACE, ZONE_H,
  upgradePrice, walkSpeed, zoneOf,
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

describe('shop', () => {
  it('buys the pad you stand on exactly once per stand', () => {
    const game = createGame()
    game.save.coins = upgradePrice('pick', 0)
    Object.assign(game.player, SHOP.pick)
    runFor(game, 0.5)
    expect(game.save.upgrades.pick).toBe(1)
    expect(game.save.coins).toBe(0)
    runFor(game, 3) // still standing: cannot chain-buy without coins anyway
    expect(game.save.upgrades.pick).toBe(1)
  })

  it('upgrades change the derived numbers', () => {
    const game = createGame()
    const base = { pick: pickDamage(game), pack: capacity(game), boots: walkSpeed(game) }
    game.save.upgrades = { pick: 2, pack: 2, boots: 2 }
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
    runFor(game, 1)
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
    expect(game.save.gatePaid).toBe(60)
    expect(game.save.gates).toBe(0)
    game.save.coins = GATES[0].price - 60
    runFor(game, 4)
    expect(game.save.gates).toBe(1)
    expect(game.save.gatePaid).toBe(0)
  })

  it('an open gate lets the player dig into the next stratum', () => {
    const game = createGame()
    game.save.gates = 1
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
  it('hires at the pad, capped at three, price ladder honored', () => {
    const game = createGame()
    game.save.coins = HELPER_PRICES[0]
    Object.assign(game.player, HELPER_PAD)
    runFor(game, 0.5)
    expect(game.save.helpers).toBe(1)
    expect(game.helpers.length).toBe(1)
    expect(game.save.coins).toBe(0)
    game.save.coins = 99999
    runFor(game, 1.2) // cooldown passed: buys #2
    runFor(game, 1.2) // buys #3
    runFor(game, 3)
    expect(game.save.helpers).toBe(3)
    expect(game.save.coins).toBe(99999 - HELPER_PRICES[1] - HELPER_PRICES[2])
  })

  it('a helper mines and sells at half value without touching the contract', () => {
    const game = createGame()
    game.save.contract = { ore: 'stone', need: 5, done: 0, reward: 10 }
    game.save.helpers = 1
    game.helpers.push({ x: DEPOT.x, y: DEPOT.y, stack: [], rockId: null, mineTimer: 0, sellTimer: 0 })
    // park the player far away so only the helper acts
    game.player.x = 500; game.player.y = 900
    runFor(game, 60)
    expect(game.save.coins).toBeGreaterThan(0)
    expect(game.save.contract.done).toBe(0)
  })

  it('reload respawns the hired helpers', () => {
    const game = createGame()
    game.save.helpers = 2
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
    game.save.gates = 1
    game.save.gatePaid = 77
    const storage = memory()
    storeSave(game.save, storage)
    const back = loadSave(storage)
    expect(back).toEqual(game.save)
  })

  it('round trips the qy1 code and rejects garbage', async () => {
    const game = createGame()
    game.save.coins = 500
    game.save.gates = 2
    const { encodeSave } = await import('./save')
    const code = await encodeSave(game.save)
    expect(code.startsWith('qy1.')).toBe(true)
    expect(await decodeSave(code)).toEqual(game.save)
    await expect(decodeSave('nope')).rejects.toThrow()
  })
})

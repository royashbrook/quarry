import { describe, expect, it } from 'vitest'
import {
  capacity, createGame, DEPOT, GATES, ORES, pickDamage, runFor, SHOP,
  upgradePrice, walkSpeed, ZONE_W, zoneOf,
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
  it('a closed gate is a wall', () => {
    const game = createGame()
    game.player.x = ZONE_W - 120
    game.player.y = 400
    runFor(game, 5, { x: 1, y: 0 })
    expect(game.player.x).toBeLessThanOrEqual(ZONE_W - 30)
    expect(zoneOf(game.player.x)).toBe(0)
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

  it('an open gate lets the player walk through', () => {
    const game = createGame()
    game.save.gates = 1
    game.player.x = ZONE_W - 120
    game.player.y = 400
    runFor(game, 6, { x: 1, y: 0 })
    expect(zoneOf(game.player.x)).toBe(1)
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

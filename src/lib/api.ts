// the narrow surface the DOM chrome drives the engine through.
//
// the shell never receives the live GameState: it reads structured snapshots and calls
// actions. that keeps the one-way rule intact (UI imports the engine, never the other
// way) and means a chrome bug cannot corrupt simulation state by assignment.
import type { GameState, UpgradeId } from '../engine'

export { buyUpgrade, hireHelperNow, prestigeNow } from '../engine'

export type GameApi = {
  snapshot: () => GameState
  buy: (id: UpgradeId) => void
  hire: () => void
  prestige: () => boolean
}

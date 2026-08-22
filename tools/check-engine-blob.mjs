// the deterministic engine is pinned by BYTES, not just by a passing test.
//
//   node tools/check-engine-blob.mjs
//
// vitest proving engine.test.ts still passes does NOT prove src/engine.ts is
// byte-identical to the reviewed baseline: a subtle edit that keeps the tests green
// still breaks the load-bearing "engine stays pure and unchanged through the wrap"
// guarantee. so CI asserts the git blob hash. if the engine ever legitimately
// changes (shootit-style tuning), BASELINE updates in the same commit with the why.
import { execSync } from 'node:child_process'

const FILE = 'src/engine.ts'
const BASELINE = '07b31a41d02b4a678710e60fada4e40fbb4bc7aa'

const actual = execSync(`git rev-parse HEAD:${FILE}`, { encoding: 'utf8' }).trim()

if (actual !== BASELINE) {
  console.error(`engine pin FAILED: ${FILE}`)
  console.error(`  expected blob ${BASELINE}`)
  console.error(`  actual blob   ${actual}`)
  console.error('  the engine changed. if deliberate, update BASELINE here in the same commit with the reason.')
  process.exit(1)
}
console.log(`engine pin ok: ${FILE} == ${BASELINE}`)

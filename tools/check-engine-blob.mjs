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
// 302088b is main's engine as of #38 (two rocks moved off the pads, 2026-09-05),
// taken byte for byte when main was merged into the conversion. the conversion
// itself never edited the engine: the previous baseline 07b31a41 was the same
// file before that rock move.
const BASELINE = '302088b77fb2f64a471c4101a7547959c9b605ba'

const actual = execSync(`git rev-parse HEAD:${FILE}`, { encoding: 'utf8' }).trim()

if (actual !== BASELINE) {
  console.error(`engine pin FAILED: ${FILE}`)
  console.error(`  expected blob ${BASELINE}`)
  console.error(`  actual blob   ${actual}`)
  console.error('  the engine changed. if deliberate, update BASELINE here in the same commit with the reason.')
  process.exit(1)
}
console.log(`engine pin ok: ${FILE} == ${BASELINE}`)

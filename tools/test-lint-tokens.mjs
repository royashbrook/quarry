// the linter's own test, and an ORACLE rather than a smoke test.
//
//   node tools/test-lint-tokens.mjs
//
// the first version only checked exit codes, and every negative fixture was ALSO
// missing most of the vocabulary, so it exited nonzero for reasons unrelated to the
// rule it claimed to cover. review disabled every real check in the linter and this
// harness still reported "passes". a test that stays green with the feature deleted
// measures nothing.
//
// so: each negative fixture is the COMPLETE VALID BASELINE plus exactly ONE defect,
// and the harness asserts the SPECIFIC diagnostic that defect must produce.
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const lint = join(here, 'lint-tokens.mjs')
const run = file => spawnSync('node', [lint, file], { encoding: 'utf8' })

let failures = 0
const fail = msg => { failures++; console.log(msg) }

// positive: a complete, contract-valid stylesheet must be clean
const passDir = join(here, 'token-fixtures/pass')
for (const name of readdirSync(passDir).filter(f => f.endsWith('.css'))) {
  const r = run(join(passDir, name))
  if (r.status !== 0) fail(`pass/${name}: expected clean, got:\n      ${(r.stdout || '').trim().split('\n').slice(0, 4).join('\n      ')}`)
}

// negative: baseline + ONE defect, and the diagnostic must name THAT defect
const failDir = join(here, 'token-fixtures/fail')
for (const name of readdirSync(failDir).filter(f => f.endsWith('.css'))) {
  const expected = readFileSync(join(failDir, name.replace(/\.css$/, '.expect')), 'utf8').trim()
  const r = run(join(failDir, name))
  const out = (r.stdout || '').trim()
  if (r.status === 0) { fail(`fail/${name}: expected a violation, got clean`); continue }
  if (!out.includes(expected)) {
    fail(`fail/${name}: expected the diagnostic to mention "${expected}", got:\n      ${out.split('\n').slice(0, 4).join('\n      ')}`)
    continue
  }
  // and it must be the ONLY thing wrong: one defect, one diagnostic
  const count = Number(/(\d+) token-contract problem/.exec(out)?.[1] ?? 0)
  if (count !== 1) fail(`fail/${name}: expected exactly 1 problem (baseline + one defect), got ${count}:\n      ${out.split('\n').slice(0, 5).join('\n      ')}`)
}

console.log(failures ? `\n${failures} linter defect(s)` : 'lint-tokens passes its fixture oracle')
process.exit(failures ? 1 : 0)

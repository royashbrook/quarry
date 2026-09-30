// copy lint for the repo's own public text.
//
//   node tools/lint-copy.mjs
//
// nothing else proves the repo's own WORDS: a banned claim ("no tracking", we run a
// cookieless beacon) or an em-dash could ship and only a human catch it. this closes
// that hole. the svelte glob matters: the shell moves about/HUD/maker-mark copy into
// *.svelte, so those are scanned or that copy goes unseen (par's carry-forward).
//
// the trap: the rule text itself quotes the banned phrase, so a naive grep flags the
// lines that define the rule. a line opts out explicitly with a `copy-lint-ok` marker.
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const MARKER = 'copy-lint-ok'

const RULES = [
  {
    name: 'false privacy claim',
    // banned outright in our copy: we run a beacon, so these sentences are not true
    test: /\bno tracking\b|\bno analytics\b|\bwe do ?n'?o?t track\b/i,
    why: 'we run a cookieless beacon, so this is false. use the ethos line from the standard.',
  },
  {
    name: 'em-dash',
    test: /—|\s--\s/,
    why: 'house voice uses a colon, a comma, or parentheses instead.',
  },
]

const files = execSync("git ls-files '*.md' '*.html' '*.svelte'", { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const hits = []
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (line.includes(MARKER)) return
    for (const rule of RULES) {
      if (rule.test.test(line)) hits.push({ file, line: i + 1, rule, text: line.trim().slice(0, 90) })
    }
  })
}

for (const h of hits) console.log(`${h.file}:${h.line}  ${h.rule.name}\n    ${h.text}\n    ${h.rule.why}`)
console.log(hits.length ? `\n${hits.length} problem(s) in ${files.length} files` : `clean: ${files.length} files`)
process.exit(hits.length ? 1 : 0)

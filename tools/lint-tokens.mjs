// the shell theme-token contract, enforced mechanically.
//
//   node tools/lint-tokens.mjs <file.css> [more.css ...]
//
// all files given in ONE invocation are treated as ONE project, so the contract's
// allowed split (a theme.css plus the consumer stylesheet) is legal.
//
// WHY: hand-auditing a whole-file property does not work, which eight review rounds
// demonstrated. the first version of this linter was itself untested and passed real
// violations; tools/test-lint-tokens.mjs is now its fixture matrix and runs in `check`.
//
// the rules, from docs/shell-theme-tokens.md:
//   1. shell rules consume tokens ONLY. literal colours, radii, shadow geometry and
//      font families are legal exclusively inside a theme definition.
//   2. no dead tokens: declared and consumed by nothing is decoration.
//   3. the fixed vocabulary is required: every theme declares the whole set.
//   4. the signature (--mark-heart) has the SAME value in every theme.
//   5. a skinnable shell has at least a second theme, or nothing is proven swappable.
//   6. a semantic token must not be overridden by a generic one: an accent-backed
//      control reads --ink-on-accent, not --ink.
import { readFileSync } from 'node:fs'

const FIXED = [
  '--surface', '--surface-raised', '--surface-sunk',
  '--ink', '--ink-dim', '--ink-on-accent',
  '--accent', '--accent-dim', '--line',
  '--font-ui', '--font-display', '--font-mono',
  '--radius', '--shadow', '--shadow-pressed',
  '--mark-heart',
]

const files = process.argv.slice(2)
if (!files.length) {
  console.log('usage: lint-tokens.mjs <file.css> [more.css ...]')
  process.exit(2)
}

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')

// a tiny block parser: selector + its declarations. handles one-line and multi-line
// blocks alike, which a line-oriented regex cannot.
function parseBlocks(css) {
  const blocks = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const selector = css.slice(i, open).trim().split('}').pop().trim()
    const body = css.slice(open + 1, j - 1)
    if (!/^@/.test(selector)) blocks.push({ selector, body })
    else blocks.push(...parseBlocks(body)) // at-rules: lint their contents
    i = j
  }
  return blocks
}

const declarationsOf = body =>
  body.split(';').map(d => d.trim()).filter(Boolean).map(d => {
    const c = d.indexOf(':')
    return c < 0 ? null : { prop: d.slice(0, c).trim(), value: d.slice(c + 1).trim() }
  }).filter(Boolean)

const isThemeSelector = s =>
  /^:root(\s*\[data-theme=("|')?[^\]]+\])?$/.test(s.trim()) ||
  /^\[data-theme=("|')?[^\]]+\]$/.test(s.trim())

const COLOUR = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*[\d.]|\bhsla?\(\s*[\d.]|\b(?:oklch|oklab|lab|lch|color)\(\s*[\d.])/
const LENGTH = /(^|[\s(,])-?\d*\.?\d+(rem|px|em|%)\b/

const problems = []
const declaredPerTheme = new Map() // themeSelector -> Map(token -> value)
let consumerText = ''

for (const file of files) {
  const css = stripComments(readFileSync(file, 'utf8'))
  consumerText += '\n' + css
  for (const { selector, body } of parseBlocks(css)) {
    const decls = declarationsOf(body)
    if (isThemeSelector(selector)) {
      const map = declaredPerTheme.get(selector) ?? new Map()
      for (const { prop, value } of decls) if (prop.startsWith('--')) map.set(prop, value)
      declaredPerTheme.set(selector, map)
      continue
    }
    // ---- rule 1: no literals in shell rules ----
    for (const { prop, value } of decls) {
      if (prop.startsWith('--')) continue
      const p = prop.toLowerCase()
      const bare = value.replace(/var\(\s*--[a-z0-9-]+\s*(,[^)]*)?\)/g, '')
      if (COLOUR.test(bare)) problems.push(`${file}  ${selector} { ${prop} }  colour literal: consume a colour token`)
      if (/border-radius|^border(-[a-z]+)?-radius/.test(p) && LENGTH.test(bare)) {
        problems.push(`${file}  ${selector} { ${prop} }  radius literal: consume --radius`)
      }
      if (/box-shadow|text-shadow/.test(p) && LENGTH.test(bare)) {
        problems.push(`${file}  ${selector} { ${prop} }  shadow geometry: consume --shadow / --shadow-pressed`)
      }
      if (/^font-family$/.test(p) && bare.replace(/[\s,]/g, '')) {
        problems.push(`${file}  ${selector} { ${prop} }  font literal: consume --font-ui / --font-display / --font-mono`)
      }
    }
    // ---- rule 6: a generic token must not override a semantic one ----
    const backgrounds = decls.filter(d => /^background(-color)?$/.test(d.prop.toLowerCase()))
    const colours = decls.filter(d => d.prop.toLowerCase() === 'color')
    const onAccent = backgrounds.some(d => /var\(\s*--accent\s*\)/.test(d.value))
    const lastColour = colours[colours.length - 1]
    if (onAccent && lastColour && /var\(\s*--ink\s*\)/.test(lastColour.value)) {
      problems.push(`${file}  ${selector}  semantic override: --accent background with --ink text, use --ink-on-accent`)
    }
  }
}

// a later rule may override an earlier semantic choice for the SAME selector
const bySelector = new Map()
for (const file of files) {
  const css = stripComments(readFileSync(file, 'utf8'))
  for (const { selector, body } of parseBlocks(css)) {
    if (isThemeSelector(selector)) continue
    const entry = bySelector.get(selector) ?? { accent: false, ink: false, sameRule: false }
    let a = false
    let k = false
    for (const { prop, value } of declarationsOf(body)) {
      const p = prop.toLowerCase()
      if (/^background(-color)?$/.test(p) && /var\(\s*--accent\s*\)/.test(value)) { entry.accent = true; a = true }
      if (p === 'color' && /var\(\s*--ink\s*\)/.test(value)) { entry.ink = true; k = true }
    }
    if (a && k) entry.sameRule = true // already reported by the in-rule check above
    bySelector.set(selector, entry)
  }
}
for (const [selector, { accent, ink, sameRule }] of bySelector) {
  // only the SPLIT case belongs here: a same-rule violation is already reported above,
  // and reporting it twice made one defect look like two (the oracle caught that).
  if (accent && ink && !sameRule) problems.push(`${selector}  semantic override across rules: --accent background ends up with --ink text`)
}

const themes = [...declaredPerTheme.entries()]
const base = themes.find(([s]) => /^:root$/.test(s.trim()))

// ---- rule 3: the fixed vocabulary is required, in EVERY theme ----
// checking only the base theme let an empty or partial alternate pass, which is the
// same declarations-only hole one level up: an alternate that declares two tokens is
// not a theme, it is a patch, and the shell falls back to the base for the rest.
if (base) {
  for (const token of FIXED) {
    if (!base[1].has(token)) problems.push(`:root  missing required token ${token}`)
  }
} else problems.push('no :root theme definition found')

// every token the SHELL CONSUMES must exist in every theme, not just the required set.
// an optional token (--warn) that the shell uses but an alternate omits falls back to the
// base theme value: a light-theme red rendered on a dark surface. same class as the
// contrast bug, and the required-set-only check could not see it.
const consumed = new Set([...consumerText.matchAll(/var\(\s*(--[a-z0-9-]+)\s*[,)]/g)].map(m => m[1]))
for (const [selector, map] of declaredPerTheme) {
  if (!/data-theme/.test(selector)) continue
  const need = [...new Set([...FIXED, ...[...consumed].filter(t => base?.[1].has(t))])]
  const missing = need.filter(t => !map.has(t))
  if (missing.length) {
    problems.push(`${selector}  incomplete alternate theme: missing ${missing.join(', ')}`)
  }
}

// ---- rule 5: a second theme must exist ----
const alternates = themes.filter(([s]) => /data-theme/.test(s))
if (!alternates.length) problems.push('no second theme: swappability is asserted, not shown. add a [data-theme="..."] block')

// ---- rule 4: the signature is identical in every theme ----
const hearts = new Set(themes.map(([, m]) => m.get('--mark-heart')).filter(Boolean))
if (hearts.size > 1) {
  problems.push(`--mark-heart differs between themes (${[...hearts].join(' vs ')}): a theme repainting the signature is not a reskin`)
}

// ---- rule 2: no dead tokens (project-wide, and a comment is not a consumer) ----
const declaredAll = new Set(themes.flatMap(([, m]) => [...m.keys()]))
for (const token of declaredAll) {
  const used = new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(consumerText)
  if (!used) problems.push(`dead token ${token}: declared in a theme and consumed by nothing`)
}

for (const p of problems) console.log(p)
console.log(problems.length ? `\n${problems.length} token-contract problem(s)` : `token contract clean: ${files.join(', ')}`)
process.exit(problems.length ? 1 : 0)

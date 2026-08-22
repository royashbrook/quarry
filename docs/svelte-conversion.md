# quarry -> svelte conversion note

the per-game delta from the shared shell spec (sortit pilot). read this with that
spec, not instead of it: this file only records where quarry differs, everything
unstated follows the pilot.

revision history: v1 blessed nothing (review: 1 blocker + 7 P2 at spec head
`4cf8668`, baseline green 45/45 vitest + 10/10 playwright). v2 folds all 8 in, each
tagged `[was: BLOCKER]` / `[was: P2.n]` at the point it lands. v3 adds the shell
theme-token layer (the scope lock, 2026-08-21): quarry is the reference adopter,
see the new section below. v4 closes the review v2-re-review (1 blocker + 2 P2 at head
`53c4aaa7`): the no-tags version blocker is closed at root (bootstrap tag pushed on
main), plus the observable-instance and exact-clock contracts. v5 closes the review v4
re-review (0 blockers + 2 P2 at head `4b504209`): the tag is reshaped to major.minor
`v0.1` so the stamp is canonical 3-part, and the canvas exemption is narrowed so the
HUD chrome is tokenized shell, not exempt game art. v6 closes the review v5 re-review (0
blockers + 2 version P2 at head `7a12f57`): every `v0.1.0` / frozen-count reference is
corrected to `v0.1` with a derived `N`, and the CI stamp gate is anchored
`^\d+\.\d+\.\d+$` with a fallback that satisfies it. v6 is the current head for review;
tags `[was: v2-BLOCKER]` / `[was: v2-P2.n]` / `[was: v4-P2.n]` / `[was: v5-P2.n]`.

## why quarry is a different shape than the pilot

sortit was plain vanilla (no build): its conversion was a real toolchain adoption
(add sveltekit, move engine into `src/lib/engine`). quarry is already vite +
typescript + vitest + playwright, and its engine is already isolated and pure:

> `src/engine.ts`: "the pure simulation. no canvas, no DOM: everything here is
> deterministic and unit-testable. rendering reads this state, never writes it."

so the load-bearing rule (deterministic engine stays framework-free, UI imports it
one-way, verifiers import the same module) is **already satisfied** here, and
`src/engine.test.ts` (vitest) is the standing proof. we do not touch engine.ts.

the second difference: sortit renders the play surface as DOM (tube buttons, FLIP
on spans). quarry renders to a **canvas** (`render.ts` Renderer, `viewport.ts`
device-pixel backing, `depth.ts`). svelte does not own the play surface. svelte
owns the canvas ELEMENT and the DOM chrome around it. this is the canvas shape;
scoopaloo gets the same treatment if it is also canvas.

## engine is pinned, not just "unchanged" [was: P2.4]

vitest proving the engine still passes is NOT proof the engine bytes are identical:
a subtle edit that keeps tests green still breaks the load-bearing guarantee. so the
conversion PR pins it mechanically, the same way the pilot blob-checked its 15 engine
files:

- baseline: `src/engine.ts` blob **`07b31a41d02b4a678710e60fada4e40fbb4bc7aa`**
  (verified on origin/main and the conversion branch, 2026-08-21).
- CI asserts `git rev-parse HEAD:src/engine.ts` equals that blob. if the engine ever
  legitimately changes (shootit-style tuning), the pin updates in the SAME commit
  with the why, so the change is deliberate and visible, never silent.

## what stays framework-free (plain modules, imported one-way)

- `engine.ts` verbatim (pinned above): simulation, upgrades, contracts, save schema.
- `viewport.ts`, `depth.ts`, `input.ts`, `save.ts`: the canvas pipeline and glue. not
  svelte, they stay as modules the component drives.
- `render.ts` stays a module, but only for the **canvas world + game art** (rocks,
  chips, sparks, float text, the mined world). its persistent **HUD chrome** is NOT
  exempt: see the theme-token section, it is shell and must be tokenized.

## what svelte takes over (this is `main.ts`'s job, split up)

`src/main.ts` today: grabs `#game` canvas, `createGame(loadSave())`, fits the
viewport, builds `Renderer` + `Controls`, runs the RAF loop, exposes the
`window.__quarry` test hooks. that whole file becomes a `Game.svelte`:

1. the component owns `<canvas>` via `bind:this`.
2. **one** `$effect` owns the lifecycle. teardown must be total [was: P2.1]:
   - **RAF ledger**: store the id returned by EVERY `requestAnimationFrame`
     reschedule (not just the first), so cleanup cancels the LIVE frame, not a stale
     one. a loop that reschedules and only remembers the first id leaks on teardown.
   - **`Controls.destroy()`**: `input.ts` currently adds ~8 anonymous listeners that
     cannot be removed. add a `destroy()` that removes every one (named handlers or a
     stored `AbortController` signal), called on cleanup.
   - clean **every** retained global: `resize` listener, `ResizeObserver`, any timer,
     and the audio context. nothing survives unmount.
3. viewport fit stays in `viewport.ts`; the component wires `resize` + a
   `ResizeObserver(document.body)` to it, same as main.ts does now.
4. DOM chrome becomes svelte components on the shared shell: menu, shop HUD,
   contracts, modals (real `showModal()` Modal.svelte from the pilot), the
   genre-appropriate bottom control bar, about + the real maker mark, version stamp.

## the shell theme-token layer (quarry is the reference adopter) [v3, the brand gate scope lock]

the new fleet requirement: everything skinnable, structure fixed, look a swappable
layer. the concrete mechanism is the shared standard at kidgames
`docs/shell-theme-tokens.md`
(https://github.com/royashbrook/kidgames/blob/main/docs/shell-theme-tokens.md). quarry
is the first game to bake the SHELL theme layer in, so it is the reference implementation
that the standard extracts from.

what this means for the conversion:

- the svelte shell components (nav, menu, shop HUD frame, modals, settings, about, version
  stamp, the bottom control bar) take their colors/fonts/surfaces ONLY from the token set
  in that doc (`--surface*`, `--ink*`, `--accent*`, `--line`, `--font-*`, `--radius`,
  `--shadow`). zero color literals in shell component styles.
- quarry ships its own theme by overriding those token values in one scoped place
  (`[data-theme="quarry"]` on the root, or a `theme.css` loaded after the shell). the
  mining look lives entirely in token values, the structure is the shared shell.
- **the HUD is chrome, not game art** [was: v4-P2.1]. `render.ts` draws two different
  things and only ONE is exempt. exempt: the canvas WORLD + game art (rocks, chips,
  sparks, float text). NOT exempt: `drawHud` (`render.ts:576-631`) paints the always-on
  coins/pack readout, the contract card, depth status, the first-minute coach, and the
  sound status with LITERAL colors. the token contract puts HUD frames + type in the
  shell layer, and this spec already says HUD + contracts become svelte, so exempting
  all of `render.ts` was a self-contradiction. resolve it one of two ways, default to
  the first:
  1. **move the HUD chrome to a tokenized svelte DOM overlay** over the canvas (coins,
     pack, contract, depth, coach, sound toggle). cleanest, it is chrome, it belongs in
     the shell, and it reskins for free with the token layer.
  2. if a piece must stay canvas-drawn (perf or layering), the renderer **reads the
     resolved shell token values** (`getComputedStyle(root).getPropertyValue('--ink')`
     etc.) instead of literals, and that path is included in the second-theme proof.
  either way, no literal HUD colors survive, and the HUD reskins under a theme swap.
- acceptance (the brand gate's skinnable half, checked live): shell paint resolves from tokens
  **including the HUD**, flipping to a second theme changes only paint (world AND HUD
  chrome), structure pieces all still present.

## the test hooks are a contract, keep them [was: P2.3]

`window.__quarry` (snapshot / movePlayer / advance / viewport / cameraY /
joystickOrigin / pause / setTime / audioState) is what the playwright specs drive:
`camera.spec`, `offline.spec`, `menu.spec`, `audio.spec`, `reset.spec`, `smoke.spec`.

- **guard it**: expose the hooks only under `import.meta.env.DEV || import.meta.env.MODE === 'test'`,
  the way main.ts gates them now. they must NOT ship to the prod bundle.
- **TS-optional so strict mode permits the delete** [was: v2-P2.2]: declare
  `Window.__quarry` as OPTIONAL (`__quarry?: ...`) in the global, or strict TypeScript
  rejects the `delete window.__quarry` that identity-safe cleanup needs.
- **prove it is absent in prod** [was: v2-P2.2]: the ordinary playwright server builds
  with `--mode test`, where the hook is PRESENT, so that suite cannot prove the guard
  strips it. add a separate production-build/preview smoke that asserts
  `window.__quarry` is `undefined`.
- **identity-safe cleanup**: on teardown, only delete `window.__quarry` if it is the
  object THIS mount installed (a remount must not clear the new mount's hooks).
- **the two-clock split, spelled exactly** [was: v2-P2.2]: RAF updates its wall-clock
  baseline on EVERY frame even while paused; `pause(true)` gates only the RAF
  simulation/camera step; `advance(seconds)` works while paused; `setTime` changes
  simulation time only. pin it with this exact test sequence: pause -> `setTime(10)` ->
  wait (state frozen at 10) -> `advance(2)` (now 12) -> wait (frozen at 12) -> resume,
  and assert NO catch-up jump (the wall-clock baseline moved under pause, so resume does
  not replay the paused span). this is what keeps `camera.spec`/`audio.spec` from going
  flaky.

## prove the lifecycle, not just reload [was: P2.2 + v2-P2.1]

quarry's current e2e reloads the page, which cannot detect a loop leaked WITHIN one
document. add a **same-document mount -> unmount -> remount** playwright proof. counts
alone are weak, so the proof asserts the observable old/new-instance contract:

1. mount Game, capture the installed `window.__quarry` as the OLD hook.
2. unmount. assert `window.__quarry` is CLEARED (global gone), and the old hook's
   snapshot time is FROZEN (read it, wait, read again, unchanged: the loop that fed it
   is dead).
3. remount. assert a DISTINCT new hook is installed whose snapshot time ADVANCES, while
   the retained old hook stays stopped.
4. instrumented live-RAF-loop and listener counts (exactly one loop after remount, zero
   orphaned listeners) stay as stronger supplementary assertions.

this is the test that catches a leaked loop or a stale hook that a reload-only suite
cannot see.

## PWA shell: adopt the pilot's, drop quarry's own [was: P2.6]

quarry has its own `wrangler.jsonc` + offline SW (`offline.spec` proves it). replace
that with the pilot pieces AND spell the artifacts exactly, because squash-merge hides
a dirty tree, it does not prevent one:

- sveltekit `adapter-static`, output to **`./build`**; `wrangler.jsonc` assets
  directory set to `./build`.
- required build artifacts, each asserted present in CI: `build/index.html`,
  `build/service-worker.js`, `build/_app/version.json`, `build/manifest.webmanifest`, and
  **`build/rescue.html`** must be preserved.
  (the spec said `manifest.json`; quarry has always shipped `manifest.webmanifest`, which
  is the registered media type and what its index links. AMENDED DELIBERATELY to match
  the app rather than renaming a live asset for a doc typo: a manifest rename changes an
  installed PWA fetch path for no benefit.)
  the old wording had (quarry ships a rescue page; carry it into
  static/ so it prerenders).
- `.gitignore` must list `build/`, `.svelte-kit/`, `node_modules/`, `package` output.
  **ignore hygiene is a gitignore job, not a squash job** (the pilot's node_modules
  scar: squashing kept it out of history but the working tree still staged 1723 files;
  the fix was the ignore file, the squash was only damage control).
- manual service worker with **version.json network-first** (the pilot's round-3 scar:
  cache-first pins the client to its booted version), `$app/state` `updated` store,
  git-tag version stamp (`appVersion()`), SW precache includes `prerendered`.

## the version path must actually produce two versions [was: v2-BLOCKER]

the inherited `appVersion()` runs `git describe --tags` and falls back to the constant
`0.0.0-dev` when there are no tags. quarry had **zero tags** (local or remote), so every
production build would stamp the same SvelteKit version, `updated.check()` could never
discover a version B, and the A-to-B acceptance test below could not honestly pass.
closed at root:

- **bootstrap tag `v0.1` pushed on `main`** (2026-08-21), a **major.minor** tag, NOT
  `v0.1.0`. the inherited helper is `` `${tag.replace(/^v/,'')}.${since}` `` (sortit
  `vite.config.js:9`): it appends commits-since to the WHOLE tag. a 3-part tag
  (`v0.1.0`) yields a 4-part `0.1.0.4`, breaking the canonical `vX.Y.Z` fleet stamp; the
  2-part `v0.1` yields `0.1.<N>` where `N = git rev-list v0.1..HEAD --count`. verified:
  `git describe origin/main` = `v0.1`. do NOT freeze a specific `N` in this spec, it
  moves with every commit, derive and assert it. [was: v2-P2.2 shape, v5-P2.1 stale-count]
- **CI asserts the stamp is exactly three numeric dot-components, anchored both ends**:
  `^\d+\.\d+\.\d+$`. without the trailing `$` the rejected `0.1.0.4` still matches as a
  prefix, so the anchor is load-bearing. [was: v5-P2.2]
- **the no-tag fallback must be nonconstant AND pass that same anchored gate**: fall back
  to the numeric 3-part `0.0.<commit-count>` (`git rev-list HEAD --count`), never a bare
  constant and never a `+sha` suffix (a suffix fails `^\d+\.\d+\.\d+$`). so tagged builds
  and untagged fallbacks both satisfy one anchored contract. [was: v5-P2.2]
- **receipts** the CI gate must carry: positive `0.1.5` passes, negative `0.1.0.5`
  fails.

## honest-update proof, A to B [was: v2-P2 / P2.5]

not "the store exists" but a real transition, and it must go THROUGH the production
version path, not hand-edit `version.json`:

- build version A through the real helper (tag `v0.1` + N commits, stamp `0.1.N`), serve it.
- add a commit, build version B the same way (now `v0.1` + N+1, stamp `0.1.<N+1>`), serve it.
- a playwright test boots A, then observes a SECOND network request to
  `/_app/version.json` and asserts the app reaches update-ready state off the genuine
  version delta. the pilot's stale-boot bug survived a weaker check twice; a
  hand-swapped version.json would reintroduce exactly that blind spot.

## CI + protection: reuse the job names, do NOT rename [was: BLOCKER]

quarry `main` protection is **strict + admin-enforced** and requires the exact
GitHub-Actions contexts **`check`** (commit-guard: every commit names an issue) and
**`functional`** (pr-check: `npm run check` + playwright e2e). the pilot renamed its
job to `pr-gate`; doing the equivalent here (renaming `functional`) makes the
conversion PR **unmergeable**, because protection waits on a context that no longer
reports.

so:

- keep the job named **`functional`** in `.github/workflows/pr-check.yml`. change what
  it RUNS, not its name: `svelte-check`, `vitest run` (engine.test.ts), `vite build`,
  the engine-blob pin, `lint:copy`, and playwright e2e.
- keep the **`check`** job (commit-guard) as-is.
- if a rename is ever wanted, it is a separate **atomic protection cutover** performed
  AFTER the new context has reported green at least once, never inside the conversion
  PR. out of scope here.
- `deploy-site.yml`'s `deploy` job (push to main, not a PR gate) updates internally to
  the svelte build + wrangler `./build`; its name is unconstrained.

## copy-lint carries in, explicitly [was: P2.7]

`lint:copy` is NOT part of the exact sortit pilot (it was the brand gate's carry-forward, added
to sortit after the pilot merged). so the conversion copies/adapts the shared tool
rather than assuming it is inherited:

- copy `tools/lint-copy.mjs` (em-dash + false-privacy-claim guard) into quarry.
- glob `*.md '*.html' '*.svelte'` so about/HUD/maker-mark copy is scanned.
- define the `lint:copy` npm script and run it inside the `functional` job in CI.

## acceptance (the brand gate's per-game cadence)

verifiers green against the byte-pinned engine, then the brand gate gates the live deploy.
concretely: engine-blob pin holds, `vitest run` 45/45, `svelte-check`, `vite build`
with the exact-artifacts check, the version stamp asserts exactly 3 dot-components,
`lint:copy` clean, playwright green including the new mount/unmount/remount and A-to-B
version proofs, AND the brand gate's skinnable half (shell paint from tokens INCLUDING the HUD,
world and HUD chrome both survive a theme swap, structure intact). squash-merge only.

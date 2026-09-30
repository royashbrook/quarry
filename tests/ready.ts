import type { Page } from '@playwright/test'

// ONE shared hook-ready wait, used after every goto/reload before any hook access or
// click on a hydrated control.
//
// vanilla installed window.__quarry synchronously on module load; svelte installs it
// after mount, so anything that dereferences the hook straight after goto() is racing
// hydration. per-spec sleeps hid that unevenly, which is why the flake moved around.
export const ready = (page: Page) =>
  page.waitForFunction(() => document.documentElement.dataset.ready === '1')

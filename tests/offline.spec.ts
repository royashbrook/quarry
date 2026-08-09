import { expect, test } from '@playwright/test'

test('reloads offline after the first visit', async ({ page }) => {
  await page.goto('/'); await page.click('#play-button')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.context().setOffline(true)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  await page.context().setOffline(false)
})

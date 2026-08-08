// render public/icon.svg to the png sizes the manifest and ios need.
// playwright is already a dev dependency, so it is our rasterizer: no new deps.
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8')
const browser = await chromium.launch()

for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>*{margin:0}</style><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`)
  const buffer = await page.screenshot({ omitBackground: true })
  writeFileSync(join(root, `public/icon-${size}.png`), buffer)
  await page.close()
}
await browser.close()
console.log('icons written: 180, 192, 512')

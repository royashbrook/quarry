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

// a maskable icon gets cropped to whatever shape the launcher likes, so the art has
// to sit inside the centre 80% and the theme colour has to bleed to every edge.
// without this an android launcher circle-crops the rounded square and eats the Q.
{
  const size = 512
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(
    `<style>*{margin:0}body{width:${size}px;height:${size}px;background:#8FCB6B;display:grid;place-items:center}</style>` +
    `<div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg.replace('<svg ', `<svg width="${size * 0.8}" height="${size * 0.8}" `)}</div>`,
  )
  writeFileSync(join(root, 'public/icon-maskable-512.png'), await page.screenshot())
  await page.close()
}
await browser.close()
console.log('icons written: 180, 192, 512')

#!/usr/bin/env node
/**
 * 隔离验证：headless Chrome 打开独立实例（3998），截图并回报页面事实。
 * 用法：DshAuth='<token>' ZipxProject='<id>' node scripts/ui-check.mjs
 * 令牌只走 URL 一次（Host 会换成 cookie），不写进截图路径。
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(root, 'screenshots')
mkdirSync(OUT, { recursive: true })

const require = createRequire('D:/DHS/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/package.json')
const { chromium } = require('playwright-core')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = process.env.DshOrigin || 'http://127.0.0.1:3998'
const AUTH = process.env.DshAuth || ''
const PROJECT = process.env.ZipxProject || ''

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
const logs = []
page.on('console', message => { if (message.type() === 'error') logs.push('console.error: ' + message.text().slice(0, 300)) })
page.on('pageerror', error => logs.push('pageerror: ' + String(error && error.message ? error.message : error).slice(0, 300)))
const failedResponses = []
page.on('response', response => {
  if (response.status() >= 400 && failedResponses.length < 20) {
    failedResponses.push(response.status() + ' ' + response.url().replace(/^http:\/\/[^/]+/, '').slice(0, 140))
  }
})
page.on('requestfailed', request => {
  const url = request.url()
  // 关键帧缩略图的失败也要记，但不能被一件小图刷屏
  if (logs.filter(line => line.startsWith('requestfailed')).length < 8) logs.push('requestfailed: ' + url.slice(0, 160) + ' — ' + String(request.failure()?.errorText || ''))
})

const report = { origin: ORIGIN, project: PROJECT, steps: [] }

await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
// 新 profile 首启会有「预览版说明」模态，先点掉，否则它的遮罩会挡住侧栏点击
const notice = page.locator('button:has-text("继续"), button:has-text("Continue")').first()
report.noticeDismissed = false
if (await notice.count() > 0) {
  await notice.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  report.noticeDismissed = true
}
await page.screenshot({ path: join(OUT, '00-shell.png') })
report.steps.push('00-shell.png')

// 侧栏入口：标签来自 locale（ZipX 创作 / ZipX Studio）
const entry = page.locator('button[aria-label="DSH导演"], button[aria-label="ZipX 创作"], button[aria-label="ZipX Studio"]').first()
report.sidebarEntryFound = (await entry.count()) > 0
if (report.sidebarEntryFound) {
  await entry.click()
  await page.waitForTimeout(6000)
  await page.screenshot({ path: join(OUT, '01-projects.png') })
  report.steps.push('01-projects.png')
  report.panelText = (await page.evaluate(() => document.body.innerText)).split('\n').slice(0, 40)
}

// 深链：URL 带 ?zipx_project=<id> 应直接打开工作台
await page.goto(ORIGIN + '/?zipx_project=' + encodeURIComponent(PROJECT), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(16000)
await page.screenshot({ path: join(OUT, '02-workbench.png') })
report.steps.push('02-workbench.png')
report.deepLinkText = (await page.evaluate(() => document.body.innerText)).split('\n').filter(Boolean).slice(0, 80)
report.media = await page.evaluate(() => {
  const images = Array.from(document.querySelectorAll('img'))
  const videos = Array.from(document.querySelectorAll('video'))
  return {
    images: images.length,
    imagesLoaded: images.filter(image => image.naturalWidth > 0).length,
    videos: videos.length,
    videoSrc: videos.length > 0 ? String(videos[0].currentSrc || videos[0].src || '').slice(0, 120) : null,
  }
})
report.slots = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('[data-slot]')).map(node => node.getAttribute('data-slot'))
  const unique = Array.from(new Set(nodes))
  return unique.filter(name => name && name.indexOf('zipx') >= 0 || name === 'main' || name === 'sidebar.panellist')
})
report.failedResponses = failedResponses
report.logs = logs.slice(0, 20)
report.logCount = logs.length
writeFileSync(join(OUT, 'ui-check-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()

#!/usr/bin/env node
/**
 * 面板分支健壮性审计（2026-11-13）：用**真浏览器**把后端打到各种坏状态，看面板会不会说谎或崩。
 *
 * 覆盖：0 个项目 / 500 / 非 JSON / 超长标题 / 403 channel_disabled。
 * 用法：DshOrigin=http://127.0.0.1:3990 DshAuth=<token> node scripts/ui-resilience.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(root, 'screenshots')
mkdirSync(OUT, { recursive: true })

const require = createRequire('D:/DHS/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/package.json')
const { chromium } = require('playwright-core')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = process.env.DshOrigin || 'http://127.0.0.1:3990'
const AUTH = process.env.DshAuth || ''

const CASES = [
  { name: 'empty', desc: '0 个项目', route: { status: 200, body: { total: 0, page: 1, page_size: 20, items: [] } } },
  { name: 'server-500', desc: '后端 500', route: { status: 500, body: { detail: 'boom' } } },
  { name: 'not-json', desc: '非 JSON 响应', route: { status: 200, raw: '<html>oops</html>' } },
  { name: 'long-title', desc: '超长标题', route: { status: 200, body: { total: 1, page: 1, page_size: 20, items: [{ id: 'p-long', title: '这是一个特别特别长的项目标题'.repeat(8), current_step: 'storyboard_design', gates: 'warn', updated_at: '2026-11-13T00:00:00Z' }] } } },
  { name: 'channel-off', desc: '渠道关闭', route: { status: 403, body: { code: 'channel_disabled', message: '渠道关闭' } } },
]

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const results = []
for (const testCase of CASES) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(String(error && error.message ? error.message : error).slice(0, 160)))
  await page.route('**/zipx-api/projects**', async route => {
    const r = testCase.route
    if (r.raw !== undefined) return route.fulfill({ status: r.status, contentType: 'text/html', body: r.raw })
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  // 首启可能有预览版说明模态，先点掉
  const dismiss = page.locator('button', { hasText: /知道了|继续|Close|Got it/i }).first()
  if (await dismiss.count() > 0) { await dismiss.click().catch(() => {}) }
  const sidebar = page.locator('[data-dsh-panel="zipx"], button:has-text("DSH导演"), button:has-text("ZipX 创作")').first()
  if (await sidebar.count() > 0) { await sidebar.click({ timeout: 3000 }).catch(() => {}) }
  await page.waitForTimeout(1500)
  const text = await page.evaluate(() => document.body.innerText)
  const panelText = text.split('\n').filter(line => /ZipX|项目|HTTP|连接|未|错误|渠道|个/.test(line)).slice(0, 24)
  await page.screenshot({ path: join(OUT, 'resilience-' + testCase.name + '.png') })
  results.push({ case: testCase.name, desc: testCase.desc, pageErrors: errors, panelText })
  await context.close()
}
await browser.close()
console.log(JSON.stringify(results, null, 1))
const crashed = results.filter(r => r.pageErrors.length > 0)
console.log(crashed.length ? 'PAGE ERRORS in ' + crashed.map(c => c.case).join(',') : 'no page errors in any case')

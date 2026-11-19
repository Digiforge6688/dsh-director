#!/usr/bin/env node
/**
 * 状态区分验证：在真浏览器里拦截 /zipx-api 的响应，证明面板能区分
 *   403 {code:"channel_disabled"}（渠道没开）与 401（未授权）。
 * 只 mock 代理的返回，不改后端、不改插件；数据本身仍来自真实页面代码。
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
const ORIGIN = process.env.DshOrigin || 'http://127.0.0.1:3998'
const AUTH = process.env.DshAuth || ''

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)

const report = {}
async function scene(name, status, body) {
  await page.route('**/zipx-api/projects**', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }))
  await page.route('**/zipx-api/capabilities', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}' }))
  // 重新加载页面，让面板以全新状态读取被 mock 的响应
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4500)
  const entry = page.locator('button[aria-label="DSH导演"], button[aria-label="ZipX 创作"], button[aria-label="ZipX Studio"]').first()
  await entry.click().catch(() => {})
  await page.waitForTimeout(3500)
  await page.screenshot({ path: join(OUT, name) })
  const text = (await page.evaluate(() => document.body.innerText)).split('\n').filter(Boolean)
  report[name] = text.filter(line => /渠道|未授权|未连接|HTTP|接口未就绪|连接 ZipX|项目库|配对|pair/.test(line)).slice(0, 10)
  await page.unroute('**/zipx-api/projects**')
  await page.unroute('**/zipx-api/capabilities')
}
await scene('03-channel-disabled.png', 403, { code: 'channel_disabled', message: '渠道未开启' })
await scene('04-unauthorized.png', 401, { detail: 'Not authenticated' })
writeFileSync(join(OUT, 'status-check-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()

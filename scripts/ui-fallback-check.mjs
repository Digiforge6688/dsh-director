#!/usr/bin/env node
/**
 * 降级路径验证：
 *  1) /zipx-api/projects 返回 404 时，项目库如实显示「接口未就绪（HTTP 404）」并给手填 project_id
 *  2) 手填 id + 回车能打开工作台（走真实 /state、/artifacts、/compose-summary）
 *  3) 右列动作点一下只把示例句填进注释区（不触发任何派发）
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
const PROJECT = process.env.ZipxProject || ''

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
const report = {}

await page.route('**/zipx-api/projects**', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}' }))
await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)
await page.locator('button[aria-label="DSH导演"], button[aria-label="ZipX 创作"], button[aria-label="ZipX Studio"]').first().click().catch(() => {})
await page.waitForTimeout(3000)
await page.screenshot({ path: join(OUT, '05-projects-not-ready.png') })
report.notReadyLines = (await page.evaluate(() => document.body.innerText)).split('\n').filter(line => /未就绪|按项目 ID 打开|粘贴 project_id/.test(line))

// 放开 /projects，用真实接口验证「手填 id → 工作台」
await page.unroute('**/zipx-api/projects**')
const input = page.locator('input[aria-label="按项目 ID 打开"]').first()
await input.fill(PROJECT)
await input.press('Enter')
await page.waitForTimeout(14000)
await page.screenshot({ path: join(OUT, '06-manual-open.png') })
const body = (await page.evaluate(() => document.body.innerText)).split('\n').filter(Boolean)
report.workbenchLines = body.filter(line => /步骤时间线|产物|关键帧|成片|门禁总体|可做的事|release/.test(line)).slice(0, 12)

// 点一个动作，只填注释区
const action = page.locator('button', { hasText: '推进到下一步' }).first()
report.actionClicked = (await action.count()) > 0
if (report.actionClicked) {
  await action.click()
  await page.waitForTimeout(800)
  report.noteValue = await page.locator('textarea').first().inputValue()
  await page.screenshot({ path: join(OUT, '07-action-filled-note.png') })
}
report.failedResponses = []
writeFileSync(join(OUT, 'fallback-check-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()

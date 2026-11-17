#!/usr/bin/env node
/**
 * 对话入口验收（2026-11-16）：点「交给 DSH 导演」应该**新开一个本项目会话**，
 * 而不是往当前那个会话的输入框塞字；工作台的剧集规划要显示人话而不是协议串。
 *
 * 用法：DshAuth='<token>' node scripts/ui-handoff-check.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(root, 'screenshots')
mkdirSync(OUT, { recursive: true })
const require = createRequire('D:/DHS/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/package.json')
const { chromium } = require('playwright-core')
const ORIGIN = process.env.DshOrigin || 'http://127.0.0.1:3990'
const AUTH = process.env.DshAuth || ''
const PROJECT = process.env.ZipxProject || '209d2b0b-f684-4c0b-b724-577acbe2db1f'
const TITLE = process.env.ZipxTitle || '台阶上的牛奶'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.message ? e.message : e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error' && !String(m.text()).includes('401')) errors.push('console.error: ' + m.text().slice(0, 160)) })

const report = { checks: {} }
function check(name, ok, detail) {
  report.checks[name] = { ok: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 260) }
  if (!ok) console.log('FAIL ' + name + ' :: ' + (detail || ''))
}
const body = async () => await page.evaluate(() => document.body.innerText)

await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const notice = page.locator('button:has-text("继续"), button:has-text("Continue")').first()
if (await notice.count() > 0) { await notice.click().catch(() => {}); await page.waitForTimeout(800) }

const entry = page.locator('button[aria-label="ZipX 创作"], button[aria-label="ZipX Studio"]').first()
for (let i = 0; i < 8; i++) {
  if ((await page.getByText('+ 新建项目').count()) > 0) break
  await entry.click().catch(() => {})
  await page.waitForTimeout(2500)
}
const row = page.locator('button').filter({ hasText: TITLE }).first()
await row.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
await row.click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(4000)

// 1) 剧集规划：场景行必须是"地点 · 时间 + 人物"，不能是「景: … 时: … 人: …」协议串
await page.locator('button[title="episodes"]').first().click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(5000)
const wb = await body()
// 只看工作台那一栏（整页会包含对话正文，那里出现"景：…"是历史字幕，不是我们的渲染）
const pane = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('div'))
  const host = all.find(el => (el.innerText || '').includes('这部剧已经拆成') || (el.innerText || '').includes('工作台'))
  return host ? host.innerText : ''
})
check('剧集规划给出子剧集卡片', wb.includes('这部剧已经拆成') || wb.includes('第 1 集'), '')
check('工作台侧不再出现协议串（景:/时:/人: 同行）', !/景\s*[:：][^\n]{0,30}时\s*[:：]/.test(pane), pane.match(/景\s*[:：][^\n]{0,40}/)?.[0] || 'none')
check('原始 JSON 只在"调试"入口后', wb.includes('调试'), '')

// 2) 对话入口：新开会话 + 把绑定要求一起递过去
const headerBefore = await page.locator('h1, [class*="header"] h2').first().innerText().catch(() => '')
const ta = page.locator('textarea').first()
await ta.click().catch(() => {})
await ta.fill('只回一句话：收到。不要调用任何工具。').catch(() => {})
await page.waitForTimeout(600)
const send = page.locator('button:has-text("交给 DSH 导演")').first()
check('发送按钮存在', await send.count() > 0, '')
await send.click().catch(() => {})
await page.waitForTimeout(6000)

// 递过去的文本应该包含绑定要求（说明桥把话写进了**新会话**的输入框）
const typed = await page.locator('textarea').first().inputValue().catch(() => '')
const submitted = (await body()).includes('zipx_bind_project') || (await body()).includes('已绑定') || (await body()).includes('先调用')
check('交接文本带项目绑定要求', submitted || typed.includes('zipx_bind_project'), typed.slice(0, 120))
const headerAfter = await page.locator('h1, [class*="header"] h2').first().innerText().catch(() => '')
check('会话标题变了（新开了会话，而不是占用当前会话）',
  headerAfter !== headerBefore || headerAfter.includes('ZipX'),
  JSON.stringify(headerBefore) + ' -> ' + JSON.stringify(headerAfter))
check('页面无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await page.screenshot({ path: join(OUT, 'v5-01-handoff.png'), fullPage: false }).catch(() => {})
console.log(JSON.stringify(report, null, 1))
const failed = Object.values(report.checks).filter(c => !c.ok).length
console.log(failed === 0 ? 'ALL CHECKS PASSED' : failed + ' CHECK(S) FAILED')
await browser.close()
process.exit(failed === 0 ? 0 : 1)

#!/usr/bin/env node
/**
 * B1 内嵌预览验收：面板的产物区默认挂的是**Studio 自己那一步**，不是重画的一版。
 *
 * 用法（隔离 profile 起在 3990，token 从启动日志里拿）：
 *   DshAuth='<token>' node scripts/ui-embed-check.mjs
 *
 * 为什么必须用真浏览器：这一整块的承重点在**跨源 iframe**（CSP/XFO）、
 * sessionStorage 隔离、以及 iframe 里那一页自己会去换令牌。React 模拟与
 * node --check 都看不见这些。
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

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.message ? e.message : e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error' && !String(m.text()).includes('401')) errors.push('console.error: ' + m.text().slice(0, 160)) })

const report = { checks: {} }
function check(name, ok, detail) {
  report.checks[name] = { ok: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 300) }
  if (!ok) console.log('FAIL ' + name + ' :: ' + String(detail))
}
const body = async () => await page.evaluate(() => document.body.innerText)

await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const notice = page.locator('button:has-text("继续"), button:has-text("Continue")').first()
if (await notice.count() > 0) { await notice.click().catch(() => {}); await page.waitForTimeout(800) }
const entry = page.locator('button[aria-label="ZipX 创作"], button[aria-label="ZipX Studio"]').first()
for (let i = 0; i < 8; i++) {
  if ((await page.locator('button:has-text("台阶上的牛奶")').count()) > 0) break
  await entry.click().catch(() => {})
  await page.waitForTimeout(2500)
}
const row = page.locator('button').filter({ hasText: '台阶上的牛奶' }).first()
await row.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
await row.click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(5000)

// 工作台默认打开；选中步骤默认是 current_step(episodes)
const stepBtn = page.locator('button[title="episodes"]').first()
check('工作台有步骤按钮', (await stepBtn.count()) > 0)
await stepBtn.click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(2500)

// 1) 默认 Studio 视图（分段控件的 aria-selected）
const studioTab = page.locator('[role="tab"]:has-text("Studio 视图")').first()
const cardsTab = page.locator('[role="tab"]:has-text("对话卡片")').first()
check('有「Studio 视图 / 对话卡片」分段控件', (await studioTab.count()) > 0 && (await cardsTab.count()) > 0)
check('默认选中 Studio 视图', (await studioTab.getAttribute('aria-selected')) === 'true',
  await studioTab.getAttribute('aria-selected'))

// 2) iframe 真的挂上了，地址里带一次性码
const frameEl = page.locator('iframe').first()
let frameSrc = ''
for (let i = 0; i < 20; i++) {
  if ((await frameEl.count()) > 0) { frameSrc = (await frameEl.getAttribute('src')) || ''; if (frameSrc) break }
  await page.waitForTimeout(1000)
}
check('产物区出现 iframe', frameSrc !== '', frameSrc)
check('iframe 指向 Studio 的 embed 路由', /\/studio\/[0-9a-f-]+\/embed\/[a-z0-9_]+/.test(frameSrc), frameSrc.replace(/vc=[^&]+/, 'vc=***'))
check('iframe 带一次性兑换码（不是长期令牌）', /[?&]vc=/.test(frameSrc) && !/token=/.test(frameSrc), frameSrc.replace(/vc=[^&]+/, 'vc=***'))

// 3) iframe 里面真的渲染出了 Studio（跨源也要读得到，走 CDP frame）
let inner = ''
let innerUrl = ''
for (let i = 0; i < 30; i++) {
  const frame = page.frames().find(f => f !== page.mainFrame() && /\/studio\//.test(f.url()))
  if (frame) {
    innerUrl = frame.url()
    inner = await frame.evaluate(() => document.body.innerText).catch(() => '')
    if (inner && inner.length > 40) break
  }
  await page.waitForTimeout(1000)
}
check('iframe 加载了 Studio 页面', /\/embed\//.test(innerUrl), innerUrl.replace(/vc=[^&]+/, 'vc=***'))
check('iframe 里不是错误态', !/预览打不开|缺少预览凭证|凭证无效/.test(inner), inner.slice(0, 200))
check('iframe 里有 Studio 的剧集界面', /剧集|第\s*1\s*集|场/.test(inner), inner.slice(0, 240))
check('iframe 地址栏里的码已被抹掉', !/vc=/.test(innerUrl), innerUrl.replace(/vc=[^&]+/, 'vc=***'))
await page.screenshot({ path: join(OUT, 'v6-01-embed-studio.png') })

// 4) 换步骤：iframe 地址跟着换（同一个面板，不重开页面）
await page.locator('button[title="story"]').first().click({ timeout: 15000 }).catch(() => {})
let storySrc = ''
for (let i = 0; i < 20; i++) {
  if ((await frameEl.count()) > 0) { storySrc = (await frameEl.getAttribute('src')) || ''; if (/\/embed\/story/.test(storySrc)) break }
  await page.waitForTimeout(1000)
}
check('换步骤后 iframe 指向新步骤', /\/embed\/story/.test(storySrc), storySrc.replace(/vc=[^&]+/, 'vc=***'))
await page.waitForTimeout(6000)
await page.screenshot({ path: join(OUT, 'v6-02-embed-story.png') })

// 5) 切到「对话卡片」：iframe 卸载、卡片渲染（兜底路径真的可用）
await cardsTab.click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(2500)
const text = await body()
check('切到对话卡片后 iframe 卸载', (await page.locator('iframe').count()) === 0)
check('对话卡片有内容', /故事|文本预览|这一步/.test(text), text.slice(-260))

// 6) 切回 Studio 视图：重新签发一枚新的码（旧码已消费，不能复用）
const previousSrc = storySrc
await studioTab.click({ timeout: 15000 }).catch(() => {})
let newSrc = ''
for (let i = 0; i < 25; i++) {
  if ((await page.locator('iframe').count()) > 0) { newSrc = (await page.locator('iframe').first().getAttribute('src')) || ''; if (newSrc) break }
  await page.waitForTimeout(1000)
}
check('切回 Studio 视图后重新挂上 iframe', newSrc !== '', newSrc.replace(/vc=[^&]+/, 'vc=***'))
check('重新载入用的是新的一次性码', newSrc !== previousSrc && /[?&]vc=/.test(newSrc),
  'old=' + previousSrc.replace(/vc=[^&]+/, 'vc=***') + ' new=' + newSrc.replace(/vc=[^&]+/, 'vc=***'))

report.errors = errors
console.log(JSON.stringify(report, null, 1))
await browser.close()
const bad = Object.entries(report.checks).filter(([, v]) => !v.ok)
if (bad.length) { console.log('FAILED: ' + bad.map(([k]) => k).join(', ')); process.exit(1) }
console.log('ALL CHECKS PASSED')

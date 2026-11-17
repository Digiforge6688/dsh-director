#!/usr/bin/env node
/**
 * 工作台 v4 验收：按步骤渲染 / 父项目→子剧集 / 导演方案可见 / 上下分栏可拖。
 * 用法：DshAuth='<token>' node scripts/ui-workbench-check.mjs
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
const PARENT = process.env.ZipxProject || '209d2b0b-f684-4c0b-b724-577acbe2db1f'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.message ? e.message : e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error' && !String(m.text()).includes('401')) errors.push('console.error: ' + m.text().slice(0, 160)) })

const report = { checks: {} }
function check(name, ok, detail) { report.checks[name] = { ok: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 260) }; if (!ok) console.log('FAIL ' + name + ' :: ' + (detail || '')) }
const body = async () => await page.evaluate(() => document.body.innerText)

await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const notice = page.locator('button:has-text("继续"), button:has-text("Continue")').first()
if (await notice.count() > 0) { await notice.click().catch(() => {}); await page.waitForTimeout(800) }
const entry = page.locator('button[aria-label="ZipX 创作"], button[aria-label="ZipX Studio"]').first()
for (let i = 0; i < 8; i++) { if ((await page.getByText('+ 新建项目').count()) > 0) break; await entry.click().catch(() => {}); await page.waitForTimeout(2500) }

// 打开父项目
const row = page.locator('button').filter({ hasText: '台阶上的牛奶' }).first()
await row.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
await row.click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(5000)

// 1) 剧集规划：应按"集/场"渲染，而不是把某一场剧本当正文
await page.locator('button[title="episodes"]').first().click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(6000)
let text = await body()
check('剧集规划有"集/场"摘要', /第\s*1\s*集/.test(text) && text.includes('场'), text.slice(0, 120))
check('剧集规划给出每集卡片', text.includes('第 1 集') || text.includes('第1集'), '')
check('剧集规划不再把整场剧本当正文', !text.includes('文本预览 episodes.scenes'), '')
await page.screenshot({ path: join(OUT, 'v4-01-episodes.png') })

// 2) 父项目的剧集阶段步骤：应提示"按集生成"并给子剧集入口
await page.locator('button[title="episode_design"]').first().click({ timeout: 15000 }).catch(() => {})
await page.waitForTimeout(2500)
text = await body()
check('剧集设计提示按集生成', text.includes('这一步按集生成'), text.slice(-300))
check('给出子剧集入口', text.includes('第 1 集 · 9 场') || text.includes('第 1 集 · '), text.slice(-300))
await page.screenshot({ path: join(OUT, 'v4-02-episode-hint.png') })

// 3) 进子剧集：步骤收敛到 episode 阶段，剧集设计有内容
const chip = page.getByRole('button', { name: /第 1 集 · / }).first()
const hasChip = (await chip.count()) > 0
check('子剧集按钮可点', hasChip)
if (hasChip) {
  await chip.click({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(7000)
  text = await body()
  check('子剧集步骤不含故事创作', !/故事创作/.test(text.split('工作台')[1] ? text.split('工作台')[1].slice(0, 800) : ''), '')
  check('子剧集的剧集设计有产物', !/这一步还没有产物/.test(text.split('工作台')[1] || ''), (text.split('工作台')[1] || '').slice(0, 200))
  await page.screenshot({ path: join(OUT, 'v4-03-sub-episode.png') })

  // 4) 导演方案（directing）：后端 /artifacts 现在必须返回它（曾因白名单手写漏掉）
  await page.locator('button[title="directing"]').first().click({ timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(5000)
  text = await body()
  const afterStep = text.split('导演方案').pop() || text
  check('导演方案能读到产物', !/这一步还没有产物/.test(text.split('导演方案').pop() || ''), afterStep.slice(0, 260))
  check('导演方案有场摘要或简报', afterStep.includes('导演简报') || /\d+\s*场/.test(afterStep), afterStep.slice(0, 220))
  await page.screenshot({ path: join(OUT, 'v4-04-directing.png') })
}

// 5) 工作台内部上下分栏可拖
const vSep = page.locator('[role="separator"][aria-orientation="horizontal"]').first()
check('工作台内有横向分隔条', (await vSep.count()) > 0)
if ((await vSep.count()) > 0) {
  const box = await vSep.boundingBox()
  if (box) {
    const before = box.y
    await page.mouse.move(box.x + box.width / 2, box.y + 3)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 3 + 90, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(700)
    const after = await vSep.boundingBox()
    check('拖动后步骤区变高', after !== null && Math.abs(after.y - before) > 40, String(before) + ' -> ' + String(after && after.y))
    await page.screenshot({ path: join(OUT, 'v4-05-split.png') })
  }
}

report.errors = errors
console.log(JSON.stringify(report, null, 1))
await browser.close()
const bad = Object.entries(report.checks).filter(([, v]) => !v.ok)
if (bad.length) { console.log('FAILED: ' + bad.map(([k]) => k).join(', ')); process.exit(1) }
console.log('ALL CHECKS PASSED')

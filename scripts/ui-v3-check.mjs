#!/usr/bin/env node
/**
 * v3 面板验收：可拖拽分栏 / 每步产物 / 新建项目 / 账户 / DSH 交接。
 * 用法：DshAuth='<token>' ZipxProject='<id>' node scripts/ui-v3-check.mjs
 *
 * 注意：这台后端可能正在跑长任务（生成成片），GET 会慢到十几秒——
 * 所以每一步都用 waitFor 而不是固定 sleep，超时如实报"没等到"，不假装通过。
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
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = process.env.DshOrigin || 'http://127.0.0.1:3990'
const AUTH = process.env.DshAuth || ''
const PROJECT = process.env.ZipxProject || ''

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })
const page = await context.newPage()
const errors = []
const failed = []
const artifactCalls = []
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)) })
page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.message ? e.message : e).slice(0, 200)))
page.on('response', r => {
  const url = r.url()
  if (url.includes('/artifacts')) artifactCalls.push(r.status() + ' ' + url.replace(/^http:\/\/[^/]+/, '').slice(0, 120))
  if (r.status() >= 400 && failed.length < 20) failed.push(r.status() + ' ' + url.replace(/^http:\/\/[^/]+/, '').slice(0, 120))
})

const report = { origin: ORIGIN, project: PROJECT, checks: {} }
function check(name, ok, detail) { report.checks[name] = { ok: !!ok, detail: detail === undefined ? null : String(detail).slice(0, 300) }; if (!ok) console.log('FAIL ' + name + ' :: ' + (detail || '')) }
async function text() { return await page.evaluate(() => document.body.innerText) }
async function waitText(needle, timeout) {
  try { await page.getByText(needle, { exact: false }).first().waitFor({ timeout: timeout || 30000 }); return true } catch { return false }
}

try {
  await page.goto(ORIGIN + '/?token=' + encodeURIComponent(AUTH) + '&zipx_project=' + encodeURIComponent(PROJECT), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  const notice = page.locator('button:has-text("继续"), button:has-text("Continue")').first()
  if (await notice.count() > 0) { await notice.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(1200) }

  const entry = page.locator('button[aria-label="DSH导演"], button[aria-label="ZipX 创作"], button[aria-label="ZipX Studio"]').first()
  await entry.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
  check('侧栏有 ZipX 入口', (await entry.count()) > 0)

  // 面板可能比侧栏晚就绪；首启还可能有"预览版说明"模态抢焦点。重试到真的出现为止。
  async function panelMounted() { return (await page.getByText('+ 新建项目').count()) > 0 }
  let mounted = false
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await panelMounted()) { mounted = true; break }
    const notice2 = page.locator('button:has-text("继续"), button:has-text("Continue")').first()
    if (await notice2.count() > 0) { await notice2.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(800) }
    await entry.click({ timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(3000)
  }
  check('点侧栏能打开面板', mounted, (await text()).slice(0, 160))
  await page.screenshot({ path: join(OUT, 'v3-01-panel.png') })

  // 舞台：点项目库里的项目（DSH 外壳会把 URL 上的 query 全部清掉，深链参数活不到面板挂载）
  const rowBtn = page.locator('button').filter({ hasText: '台阶上的牛奶' }).first()
  await rowBtn.waitFor({ state: 'visible', timeout: 60000 }).catch(() => {})
  const hasRow = (await rowBtn.count()) > 0
  check('项目库里有可点的项目', hasRow, (await text()).slice(0, 160))
  if (hasRow) await rowBtn.click({ timeout: 15000 }).catch(() => {})
  const stageReady = await page.waitForFunction(
    id => document.body.innerText.includes(id.slice(0, 8)),
    PROJECT, { timeout: 60000 },
  ).then(() => true).catch(() => false)
  check('点项目后舞台加载', stageReady, (await text()).slice(0, 200))
  await page.waitForTimeout(1500)
  const body1 = await text()
  check('默认 DSH 模式', body1.includes('对话在 DSH 里进行'))
  check('工作台可见', body1.includes('工作台'))
  check('账户入口', body1.includes('账户') || body1.includes('登录'))
  check('新建项目入口', body1.includes('新建项目'))

  // 等步骤列表（/workflow-steps 可能被后端长任务拖慢）
  const stepsReady = await page.waitForFunction(
    () => Array.from(document.querySelectorAll('button[title]')).some(n => /^(story|plot_analysis|script|episodes|episode_design|storyboard_design|keyframes|shots_hitl|compose)$/.test(String(n.getAttribute('title') || ''))),
    { timeout: 60000 },
  ).then(() => true).catch(() => false)
  check('步骤列表出现', stepsReady)
  await page.screenshot({ path: join(OUT, 'v3-02-workbench.png') })

  // 点一个"非当前"的步骤，确认它去取这一步自己的产物
  const picked = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('button[title]'))
    const ids = nodes.map(n => String(n.getAttribute('title') || '')).filter(t => /^(story|plot_analysis|script|episodes|episode_design|storyboard_design|keyframes|shots_hitl|compose)$/.test(t))
    return ids.length > 1 ? ids[1] : (ids[0] || '')
  })
  check('找到可点的步骤', picked !== '', picked)
  if (picked) {
    await page.locator('button[title="' + picked + '"]').first().click({ timeout: 15000 }).catch(() => {})
    const gotArt = await page.waitForFunction(
      needle => performance.getEntriesByType('resource').some(e => String(e.name).includes('/artifacts') && String(e.name).includes(needle)),
      picked, { timeout: 45000 },
    ).then(() => true).catch(() => false)
    check('点步骤会取这一步的产物', gotArt || artifactCalls.some(c => c.includes(picked)), JSON.stringify(artifactCalls.slice(-3)))
    await page.waitForTimeout(3000)
    await page.screenshot({ path: join(OUT, 'v3-03-step.png') })
  }

  // 拖拽分栏
  const sep = page.locator('[role="separator"]').first()
  check('分栏可拖拽', (await sep.count()) > 0)
  if ((await sep.count()) > 0) {
    const box = await sep.boundingBox()
    if (box) {
      const before = box.x
      await page.mouse.move(box.x + 3, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 3 - 160, box.y + box.height / 2, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(900)
      const box2 = await sep.boundingBox()
      check('拖动后分栏变宽', box2 !== null && Math.abs(box2.x - before) > 60, String(before) + ' -> ' + String(box2 && box2.x))
      await page.screenshot({ path: join(OUT, 'v3-04-dragged.png') })
    }
  }

  // 新建项目弹层
  await page.getByRole('button', { name: /新建项目/ }).first().click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const createText = await text()
  check('新建弹层打开', createText.includes('只建项目') || createText.includes('新建创作项目'), createText.slice(0, 80))
  await page.screenshot({ path: join(OUT, 'v3-05-create.png') })
  const cancel = page.locator('[role="dialog"]').getByRole('button', { name: '取消' }).first()
  if (await cancel.count() > 0) await cancel.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(800)

  // 账户弹层
  const accountBtn = page.locator('button[title="账户与创作者中心"]').first()
  check('账户按钮存在', (await accountBtn.count()) > 0)
  if ((await accountBtn.count()) > 0) {
    await accountBtn.click({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(5000)
    const accText = await text()
    check('账户弹层打开', accText.includes('账户与创作者中心'))
    check('账户显示身份或登录表单', accText.includes('积分') || accText.includes('密码'))
    report.accountText = accText.slice(0, 500)
    await page.screenshot({ path: join(OUT, 'v3-06-account.png') })
    const closeBtn = page.locator('[role="dialog"] button[aria-label="收起"]').first()
    if (await closeBtn.count() > 0) await closeBtn.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(600)
  }

  // 账户路由探测（不创建账号）
  report.probes = await page.evaluate(async () => {
    const out = {}
    const status = await fetch('/zipx-account/status')
    out.status = status.status
    out.statusBody = (await status.text()).slice(0, 120)
    const me = await fetch('/zipx-account/me')
    out.me = me.status
    out.meBody = (await me.text()).slice(0, 160)
    const bad = await fetch('/zipx-account/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.invalid', password: 'x' }) })
    out.badLogin = bad.status
    out.badLoginBody = (await bad.text()).slice(0, 200)
    return out
  })

  // Studio 引擎模式
  await page.getByRole('tab', { name: 'Studio 引擎' }).first().click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(4000)
  check('可切到 Studio 引擎', (await text()).includes('Studio 引擎'))
  await page.screenshot({ path: join(OUT, 'v3-07-studio-engine.png') })

  // DSH 交接：写一句话 → 交给 DSH → 应切到对话且输入框里有内容
  await page.getByRole('tab', { name: 'DSH 导演' }).first().click({ timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const composer = page.locator('textarea').first()
  check('输入框在', (await composer.count()) > 0)
  if ((await composer.count()) > 0) {
    await composer.fill('这个项目到哪一步了')
    await page.getByRole('button', { name: '交给 DSH 导演' }).first().click({ timeout: 8000 }).catch(e => { report.handoffClickError = String(e && e.message) })
    await page.waitForTimeout(4000)
    await page.screenshot({ path: join(OUT, 'v3-08-handoff.png') })
    const state = await page.evaluate(() => {
      const editable = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(n => String(n.innerText || '').slice(0, 120))
      const areas = Array.from(document.querySelectorAll('textarea')).map(a => String(a.value || '').slice(0, 120))
      return { values: areas.concat(editable), inPanel: !!document.querySelector('[data-global-panel]') }
    })
    report.handoff = state
    check('交接后 DSH 输入框拿到文本', state.values.some(v => v.includes('ZipX 项目') || v.includes('这个项目到哪一步了')), JSON.stringify(state.values))
  }
} catch (error) {
  report.crash = String(error && error.message ? error.message : error).slice(0, 400)
}

report.errors = errors
report.failedResponses = failed
report.artifactCalls = artifactCalls
console.log(JSON.stringify(report, null, 2))
await browser.close()
const bad = Object.entries(report.checks).filter(([, v]) => !v.ok)
if (bad.length > 0 || report.crash) { console.log('FAILED: ' + bad.map(([k]) => k).join(', ') + (report.crash ? ' | crash: ' + report.crash : '')); process.exit(1) }
console.log('ALL CHECKS PASSED')

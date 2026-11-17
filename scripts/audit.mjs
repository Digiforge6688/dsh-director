#!/usr/bin/env node
/**
 * 审计套件（2026-11-13）：一条命令跑完「契约自述的端点真的存在」+「render 要的字段真的有」。
 *
 * 为什么需要：前四轮审计（render / 面板分支 / 契约漂移 / 升级）都是人肉跑的，改一次代码就得重来一遍。
 * 这里把能自动化的部分固定下来；需要真浏览器或真 profile 的部分显式 SKIP 并给出命令，**不冒充通过**。
 *
 * 用法：node scripts/audit.mjs [--project <id>]
 *   环境：ZIPX_BACKEND（默认 http://localhost:8000）、ZIPX_TOKEN / ~/.zipx/dialogue-token.json
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const BACKEND = process.env.ZIPX_BACKEND || 'http://localhost:8000'
const argProject = (process.argv.indexOf('--project') > 0) ? process.argv[process.argv.indexOf('--project') + 1] : ''
const PROJECT = argProject || process.env.ZIPX_PROJECT_ID || '9c43e373-9ce6-4d72-b797-23b941541a7f'

function token() {
  if (process.env.ZIPX_TOKEN) return process.env.ZIPX_TOKEN
  const file = process.env.ZIPX_TOKEN_FILE || join(homedir(), '.zipx', 'dialogue-token.json')
  return String(JSON.parse(readFileSync(file, 'utf8')).token || '')
}
const auth = { Authorization: 'Bearer ' + token() }
let fail = 0
let skip = 0
function ok(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { fail += 1; console.log('FAIL  ' + name + (detail ? ' :: ' + String(detail).slice(0, 200) : '')) }
}
function skipped(name, why) { skip += 1; console.log('SKIP  ' + name + ' — ' + why) }
async function get(pathname, attempt = 1) {
  let res
  try {
    res = await fetch(BACKEND + pathname, { headers: auth })
  } catch (error) {
    // 2026-11-13：真机 10 步验收里这一步偶发 'fetch failed'（后端重启后连接级抖动），
    // 而 GET 重试是安全的。只重试一次，仍失败就把原因带出来——不再静默当成"审计通过"。
    if (attempt === 1) return get(pathname, 2)
    throw new Error('GET ' + pathname + ' 连接失败（已重试一次）：' + String(error && error.message ? error.message : error))
  }
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON 也算结果 */ }
  return { status: res.status, json, text }
}

console.log('=== A. 契约自述的端点真的存在（GET 类） ===')
const cap = await get('/api/v3/director/capabilities')
ok('capabilities 200', cap.status === 200, cap.status)
const manifest = (cap.json?.endpoints || []).filter(e => (e.method || 'GET') === 'GET')
ok('清单非空', manifest.length >= 8, manifest.length)
const probeable = manifest.map(e => e.path)
  .filter(p => !p.includes('/media') && !p.includes('/pair/'))
  .map(p => p.replace('{project_id}', PROJECT).replace('{dsh_session_id}', 'audit-probe'))
for (const pathname of probeable) {
  const r = await get(pathname)
  ok('GET ' + pathname.replace(BACKEND, '').split('?')[0].replace(PROJECT, '<id>') + ' 不是 404', r.status !== 404, 'HTTP ' + r.status)
}

console.log('\n=== B. render 需要的字段真的存在 ===')
const projects = await get('/api/v3/director/projects?page=1&page_size=3&gates=1')
const items = projects.json?.items || []
ok('projects[].gates/current_step', items.length > 0 && items.every(i => typeof i.gates === 'string' && !!i.current_step), JSON.stringify(items[0] || {}).slice(0, 160))

const ov = await get('/api/v3/director/project/' + PROJECT + '/overview')
ok('overview.state.current.step', !!ov.json?.state?.current?.step, ov.status)
ok('overview.delivery.has_compose 是布尔', typeof ov.json?.delivery?.has_compose === 'boolean', JSON.stringify(ov.json?.delivery || {}).slice(0, 120))

const dl = await get('/api/v3/director/project/' + PROJECT + '/delivery')
const bad = (dl.json?.checklist || []).filter(x => x && x.status !== 'pass' && x.status !== 'pending')
ok('delivery 非通过项都带原因（note/value）', bad.every(x => !!(x.note || x.value)), bad.length + ' 项')
ok('delivery.counts 有四个键', ['pass', 'warn', 'fail', 'pending'].every(k => k in (dl.json?.counts || {})), JSON.stringify(dl.json?.counts))

const cost = await get('/api/v3/director/project/' + PROJECT + '/cost?step=compose')
ok('cost 里有 balance（可以是 null）', cost.status === 200 && 'balance' in (cost.json || {}), JSON.stringify(cost.json || {}).slice(0, 120))

const ev = await get('/api/v3/director/project/' + PROJECT + '/events?limit=3')
const evItems = ev.json?.events || []
ok('events[].event_type/summary/created_at', evItems.length > 0 && evItems.every(e => e.event_type && 'summary' in e && e.created_at), ev.status)
ok('events.next_cursor 有值', !!ev.json?.next_cursor, JSON.stringify(ev.json?.next_cursor || '').slice(0, 40))

const pr = await get('/api/v3/director/progress/' + PROJECT + '?limit=3')
ok('progress[].kind/title', (pr.json?.activities || []).every(a => !!a.kind && !!a.title), pr.status)

const tl = await get('/api/v3/creative-os/timeline/' + PROJECT + '?limit=3')
ok('timeline[].event_type/summary', (tl.json?.events || []).every(e => !!e.event_type && 'summary' in e), tl.status)

const locks = await get('/api/v3/director/project/' + PROJECT + '/locks')
ok('locks 四把都在', Object.keys(locks.json?.locks || {}).length === 4, Object.keys(locks.json?.locks || {}).join(','))

console.log('\n=== C. 需要真浏览器 / 真 profile 的部分（本脚本不冒充通过） ===')
skipped('面板分支（500/非JSON/空/超长/渠道关）', 'DshOrigin=<url> DshAuth=<token> node scripts/ui-resilience.mjs')
skipped('升级/卸载/重装', '手工：装 0.1.0.tgz → 升 0.2.5.tgz → remove → add（见实施记录 §3.25）')
skipped('写路径 E2E（建了会删）', 'node scripts/e2e-write.mjs')

console.log('')
console.log(fail === 0 ? '审计通过（' + skip + ' 项显式 SKIP，不是通过）' : '审计失败：' + fail + ' 项')
process.exit(fail === 0 ? 0 : 1)

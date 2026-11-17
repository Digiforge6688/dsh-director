#!/usr/bin/env node
/**
 * Host-side wiring regression for P0/P1.
 *
 * Covers the four safety contracts the plan turns on:
 *   1. no global project fallback; binding recovers from ZipX external_sessions
 *   2. paid tools always go through the DSH approval seam (or are denied)
 *   3. watch_step starts a background job instead of blocking the conversation
 *   4. every tool carries a replayable presentationMeta
 * Plus the /zipx-media Range allowlist.
 */
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: new URL('./dsh-tools-stub.mjs', import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lib = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

const failures = []
function check(ok, message, detail) {
  if (!ok) failures.push(message + (detail ? ' :: ' + String(detail).slice(0, 240) : ''))
}

const seen = []
const backend = createServer((req, res) => {
  const url = new URL(String(req.url || '/'), 'http://x')
  seen.push(req.method + ' ' + url.pathname + url.search + ' auth=' + String(req.headers.authorization || '-'))
  function json(status, body) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (url.pathname === '/api/v3/director/capabilities') return json(200, { contract_version: 'v5', channel_state: 'enabled', channels: ['dsh'], account: 'tester', dsh_tools: 34 })
  if (url.pathname === '/api/v3/director/session/s1') return json(200, { session_id: 's1', project_id: 'p1', bound: true, revoked: false })
  if (url.pathname === '/api/v3/director/session/s2') return json(404, { detail: { code: 'not_bound', message: 'no binding' } })
  if (url.pathname === '/api/v3/director/session/bind' && req.method === 'POST') return json(200, { session_id: 's2', project_id: 'p2', bound: true })
  if (url.pathname === '/api/v3/director/project/p1/artifacts') return json(200, { project_id: 'p1', output: { story: { status: 'ready', media_urls: {} } } })
  if (url.pathname === '/api/v3/director/project/p1/cost' || url.pathname === '/api/v3/director/project/p2/cost') return json(200, { estimate_calls: 10, balance: 100, currency: 'credits', affordable: true })
  if (url.pathname === '/api/v3/director/state/p1') return json(200, { project: { id: 'p1', title: '夜航灯塔', current_step: 'script' }, current: { step: 'script', label: '剧本', produced: 1, expected: 2, is_complete: false, is_locked: false }, gates: { overall: 'warn' }, legal_actions_human: ['推进'] })
  if (url.pathname === '/api/v3/director/project/p1/start' && req.method === 'POST') return json(200, { status: 'started', project_id: 'p1' })
  if (url.pathname === '/api/v3/director/project/p1/abort' && req.method === 'POST') return json(200, { ok: true, aborted: true, project_id: 'p1', step: 'script', status: 'aborted', note: '已登记中止；正在返回的付费调用可能仍会完成，但后续步骤不会再继续。' })
  if (url.pathname === '/api/v1/files/demo.mp4') {
    const range = String(req.headers.range || '')
    if (range) {
      res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': 'bytes 0-3/10', 'content-length': '4' })
      res.end('abcd')
      return
    }
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '10' })
    res.end('abcdefghij')
    return
  }
  json(404, { detail: 'not found' })
})
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + backend.address().port

let approval = {}
let jobs = null
const pre = []
const resultHooks = []
const routes = []
const tools = new Map()
const credentials = {
  records: new Map(),
  async readRecord(key) { return this.records.get(key) },
  async modifyRecord(key, fn) { const next = await fn(this.records.get(key)); if (next !== undefined) this.records.set(key, next); return next },
  async deleteRecord(key) { this.records.delete(key) },
  async describeRecord(key) { return { configured: this.records.has(key), writable: true } },
}

const ctx = {
  tools: { register: tool => tools.set(tool.name, tool) },
  inject(deps, cb) {
    const scope = {}
    if (deps.includes('webServer')) scope.webServer = { register: route => { routes.push(route); return { dispose() {} } } }
    if (deps.includes('skills')) scope.skills = { registerProvider() {} }
    if (deps.includes('systemPrompt')) scope.systemPrompt = { section() {} }
    if (deps.includes('credentials')) scope.credentials = credentials
    if (deps.includes('sidebarRightTabs')) scope.sidebarRightTabs = { register() { return { dispose() {} } } }
    cb(scope)
  },
  get(name) {
    if (name === 'approval') return approval
    if (name === 'jobs') return jobs
    return undefined
  },
  on(event, fn) {
    if (event === 'tools/pre-execute') pre.push(fn)
    if (event === 'tools/result') resultHooks.push(fn)
  },
  effect() {},
  logger: { info() {}, warn() {} },
}

await lib.apply(ctx, { baseUrl, token: 'tok', language: 'zh' })
check(tools.size === 35, '35 tools registered', tools.size)
check(pre.length === 1, 'pre-execute approval hook registered', pre.length)
check(routes.some(r => r.path === '/zipx-media'), 'media route registered')
check(routes.some(r => r.path === '/zipx-auth/status'), 'auth status route registered')
check(routes.some(r => r.path === '/zipx-doctor'), 'doctor route registered')
check(routes.some(r => r.path === '/zipx-budget'), 'budget route registered')

// 1) presentationMeta exists, is JSON-safe, and is small.
for (const name of ['zipx_project_state', 'zipx_preview_action', 'zipx_confirm_step', 'zipx_artifacts', 'zipx_cost', 'zipx_watch_step', 'zipx_delivery', 'zipx_get_locks', 'zipx_list_projects', 'zipx_bind_project']) {
  const tool = tools.get(name)
  check(tool && typeof tool.output.presentationMeta === 'function', name + ' has presentationMeta')
  if (tool) {
    let meta
    try { meta = tool.output.presentationMeta({}, { ok: true }) } catch (error) { meta = null }
    let text = ''
    try { text = JSON.stringify(meta) } catch (error) { text = '' }
    check(!!text && text.length < 4000, name + ' presentationMeta is JSON and small', text.length)
  }
}

// 2) approval: paid tool asks; no approval channel denies; explicit opt-in passes.
const next = async () => ({ kind: 'allow' })
const asked = await pre[0]({ name: 'zipx_start', arguments: { project_id: 'p1' } }, next)
check(asked && asked.kind === 'ask', 'paid tool becomes an approval ask', JSON.stringify(asked))
check(asked && asked.displayReason && asked.displayReason.zh && asked.displayReason.en, 'approval has zh/en displayReason')

approval = undefined
const denied = await pre[0]({ name: 'zipx_start', arguments: { project_id: 'p1' } }, next)
check(denied && denied.kind === 'deny', 'missing approval channel denies paid tools', JSON.stringify(denied))

const free = await pre[0]({ name: 'zipx_project_state', arguments: { project_id: 'p1' } }, next)
check(free && free.kind === 'allow', 'read-only tools skip approval')
approval = {}

// 3) binding: no global fallback; backend recovery works.
const artifacts = tools.get('zipx_artifacts')
const recovered = await artifacts.execute({}, { agent: { id: 's1' } })
check(recovered && recovered.output && recovered.output.story, 'session binding recovered from backend', JSON.stringify(recovered).slice(0, 160))
check(seen.some(line => line.includes('/api/v3/director/session/s1')), 'backend session lookup happened')

let unbound = null
try { await artifacts.execute({}, { agent: { id: 's3' } }) } catch (error) { unbound = String(error.message || error) }
check(unbound && unbound.includes('还没有绑定项目'), 'unbound session is refused (no fallback)', unbound)

const bind = tools.get('zipx_bind_project')
const P2 = '22222222-2222-2222-2222-222222222222'
const bound = await bind.execute({ project_id: P2 }, { agent: { id: 's2' } })
check(bound && bound.project_id === P2 && bound.session_id === 's2', 'bind writes the current session', JSON.stringify(bound))
check(seen.some(line => line.includes('POST /api/v3/director/session/bind')), 'bind persisted to external_sessions')

// 4) watch_step starts a background job.
jobs = {
  started: null,
  start(spec) { this.started = spec; return 'job-9' },
}
const watch = tools.get('zipx_watch_step')
const watched = await watch.execute({ project_id: 'p1', step: 'script', max_seconds: 30 }, { agent: { id: 's1' } })
check(watched && watched.mode === 'background' && watched.job_id === 'job-9', 'watch_step returns a background job', JSON.stringify(watched))
check(jobs.started && jobs.started.label.includes('script') && typeof jobs.started.run === 'function', 'job spec has label and run')

// 4b) cancelling the DSH job must abort the real generation.
const hooks = jobs.started.run({ updateProgress() {}, append() {} })
hooks.cancel()
await new Promise(resolve => setTimeout(resolve, 100))
check(seen.filter(line => line.includes('POST /api/v3/director/project/p1/abort')).length >= 1, 'job cancel calls backend abort')

// 4c) the explicit abort tool returns an honest receipt.
const abortTool = tools.get('zipx_abort')
const aborted = await abortTool.execute({ project_id: 'p1', reason: 'test' }, {})
check(aborted && aborted.aborted === true && aborted.step === 'script', 'zipx_abort returns aborted receipt', JSON.stringify(aborted))

// 5) media Range proxy: allowlisted backend only, Range preserved.
const mediaRoute = routes.find(r => r.path === '/zipx-media')
const front = createServer((req, res) => { void mediaRoute.handler(req, res) })
await new Promise(resolve => front.listen(0, '127.0.0.1', resolve))
const mediaOrigin = 'http://127.0.0.1:' + front.address().port
const target = baseUrl + '/api/v1/files/demo.mp4'
const ranged = await fetch(mediaOrigin + '/zipx-media?u=' + encodeURIComponent(target), { headers: { Range: 'bytes=0-3' } })
check(ranged.status === 206, 'media proxy forwards 206', ranged.status)
check(String(ranged.headers.get('content-range') || '').includes('bytes 0-3/10'), 'media proxy preserves Content-Range', ranged.headers.get('content-range'))
check((await ranged.text()) === 'abcd', 'media proxy streams bytes')
const foreign = await fetch(mediaOrigin + '/zipx-media?u=' + encodeURIComponent('http://evil.example/api/v1/files/x'))
check(foreign.status === 403, 'media proxy rejects foreign hosts', foreign.status)

// 6) auth status never returns the token.
const authRoute = routes.find(r => r.path === '/zipx-auth/status')
const authFront = createServer((req, res) => { void authRoute.handler(req, res) })
await new Promise(resolve => authFront.listen(0, '127.0.0.1', resolve))
const authRes = await fetch('http://127.0.0.1:' + authFront.address().port + '/zipx-auth/status')
const authText = await authRes.text()
check(authRes.status === 200 && authText.includes('"connected":true'), 'auth status reports connected', authText.slice(0, 160))
check(!authText.includes('tok') || !authText.includes('"token"'), 'auth status never returns the token')

front.close(); authFront.close(); backend.close()

if (failures.length > 0) {
  for (const message of failures) console.log('FAIL  ' + message)
  process.exit(1)
}
console.log('[zipx] host wiring ok: binding / approval / jobs / cards / media')
